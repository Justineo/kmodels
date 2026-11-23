import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, SourceTextModule } from "node:vm";
import { build } from "vite-plus";
import { z } from "zod";
import { lookupFixtureSchema, type LookupFixtures } from "../tests/pricing-lookup-fixture.ts";
import { createInferencePriceLookup, type InferencePriceQuery } from "../src/pricing/index.ts";

const expectedPackageFiles = [
  "package/CONTRACT.md",
  "package/README.md",
  "package/dist/index.d.ts",
  "package/dist/index.js",
  "package/package.json",
  "package/query.schema.json",
  "package/schema.json",
];

const packageManifestSchema = z.object({
  name: z.literal("@kmodels/pricing"),
  type: z.literal("module"),
  dependencies: z.record(z.string(), z.string()),
});

await checkPricingPackage();

async function checkPricingPackage(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "kmodels-pricing-package-"));
  try {
    const packageDirectory = await packAndExtractPackage(temporaryDirectory);
    await checkPackageContents(packageDirectory);
    await checkConsumerTypes(packageDirectory);
    const suite = lookupFixtureSchema.parse(
      JSON.parse(
        await readFile(new URL("../tests/fixtures/pricing/lookup.json", import.meta.url), "utf8"),
      ),
    );
    const entryPath = join(packageDirectory, "dist/index.js");

    await checkNodeRuntime(entryPath, suite);
    await checkBrowserRuntime(entryPath, suite);

    console.log(
      `Packed package: ${expectedPackageFiles.length} expected files; ` +
        "unit-price queries verified in Node and browser; " +
        "consumer types verified; synthetic price data only; no transport or Node dependency in the runtime.",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function checkConsumerTypes(packageDirectory: string): Promise<void> {
  const consumer = join(packageDirectory, "consumer.mts");
  await copyFile(new URL("../tests/fixtures/pricing/consumer.ts.txt", import.meta.url), consumer);
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

async function checkNodeRuntime(entryPath: string, suite: LookupFixtures): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rejectNetworkAccess;
  try {
    const moduleExports: unknown = await import(pathToFileURL(entryPath).href);
    checkInferenceLookup(moduleExports, suite);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function checkBrowserRuntime(entryPath: string, suite: LookupFixtures): Promise<void> {
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
  checkInferenceLookup(browserModule.namespace, suite);
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

function checkInferenceLookup(moduleExports: unknown, suite: LookupFixtures): void {
  if (
    typeof moduleExports !== "object" ||
    moduleExports === null ||
    !("createInferencePriceLookup" in moduleExports) ||
    typeof moduleExports.createInferencePriceLookup !== "function"
  )
    throw new Error("Missing inference price lookup export");
  assert(!("createCalculator" in moduleExports), "Cost API must not be exported");
  assert(
    !("calculationRequestSchema" in moduleExports),
    "Cost request schema must not be exported",
  );
  const data = structuredClone(suite.datasets.base);
  const provider = data?.providers[0];
  const book = provider?.books[0];
  const offer = book?.offers[0];
  const modelRef = book?.scope.model_refs[0];
  if (!data || !provider || !book || !offer || !modelRef)
    throw new Error("Missing inference smoke fixture");
  const unconditionalIndex = provider.applicabilities.findIndex(
    ({ any_of }) => any_of.length === 1 && any_of[0]?.all_of.length === 0,
  );
  if (unconditionalIndex === -1) throw new Error("Missing unconditional applicability");
  offer.selection = [
    {
      dimension: "execution",
      coverage: "complete",
      applicability_id: unconditionalIndex,
      alternatives: ["request", "realtime"].map((value) => ({
        value: { namespace: "kmodels", value },
        applicability_id: unconditionalIndex,
      })),
      evidence: book.evidence,
    },
    {
      dimension: "billing_mode",
      coverage: "complete",
      applicability_id: unconditionalIndex,
      alternatives: [{ value: offer.billing_mode, applicability_id: unconditionalIndex }],
      evidence: book.evidence,
    },
  ];
  const mapping = {
    core_catalog_version: data.snapshot.coreCatalogVersion,
    pricing_data_version: data.snapshot.pricingDataVersion,
    sources: [],
    rules: [
      {
        provider_id: provider.snapshot.provider_id,
        model_id: "literal-model-id",
        model_ref: modelRef,
        offer_refs: [offer.id],
        fixed_selectors: [],
        evidence: book.evidence,
      },
    ],
  };
  const lookup: unknown = moduleExports.createInferencePriceLookup(data, mapping);
  if (typeof lookup !== "function") throw new Error("Missing inference lookup function");
  const reference = createInferencePriceLookup(data, mapping);
  for (const model_id of ["literal-model-id", "unreviewed-id"]) {
    for (const execution_mode of [undefined, "request", "batch", "realtime"] as const) {
      for (const offer_ref of [undefined, offer.id, "0".repeat(64)]) {
        const query: InferencePriceQuery = {
          provider_id: provider.snapshot.provider_id,
          model_id,
          ...(offer_ref === undefined ? {} : { offer_ref }),
          ...(execution_mode === undefined ? {} : { execution_mode }),
        };
        assert.equal(JSON.stringify(lookup(query)), JSON.stringify(reference(query)), model_id);
      }
    }
  }
  for (const execution of ["request", "batch", "realtime"]) {
    const query: InferencePriceQuery = {
      provider_id: provider.snapshot.provider_id,
      model_id: "literal-model-id",
      choices: [
        { dimension: "execution", value: { namespace: "kmodels", value: execution } },
        { dimension: "billing_mode", value: offer.billing_mode },
      ],
    };
    assert.equal(JSON.stringify(lookup(query)), JSON.stringify(reference(query)), execution);
  }
  for (const value of ["input_text", "cache_write_text"] as const) {
    const query: InferencePriceQuery = {
      provider_id: provider.snapshot.provider_id,
      model_id: "literal-model-id",
      meter: { namespace: "kmodels", value },
    };
    assert.equal(JSON.stringify(lookup(query)), JSON.stringify(reference(query)), value);
  }
  if (
    !("createCommercialPriceLookup" in moduleExports) ||
    typeof moduleExports.createCommercialPriceLookup !== "function"
  )
    throw new Error("Missing commercial lookup export");
  const commercial: unknown = moduleExports.createCommercialPriceLookup(data, mapping);
  if (typeof commercial !== "function") throw new Error("Missing commercial lookup function");
  const query: InferencePriceQuery = {
    provider_id: provider.snapshot.provider_id,
    model_id: "literal-model-id",
    meter: { namespace: "kmodels", value: "input_text" },
    choices: [{ dimension: "execution", value: { namespace: "kmodels", value: "request" } }],
  };
  const { provider_id, model_id, ...selection } = query;
  const subject = { kind: "model", provider_id, model_id };
  assert.equal(
    JSON.stringify(commercial({ subject, ...selection })),
    JSON.stringify({ subject, ...reference(query) }),
  );

  const dated = structuredClone(data);
  const input = dated.providers[0]?.books[0]?.offers[0]?.terms.find(
    (term) => term.kind === "rate" && term.meter.value === "input_text",
  );
  const original = input?.kind === "rate" ? input.variants[0] : undefined;
  if (input?.kind !== "rate" || !original) throw new Error("Missing dated price fixture");
  input.variants = [
    { ...original, validity: { until: { value: "2026-11-30", precision: "date" } } },
    {
      ...structuredClone(original),
      price: { ...original.price, value: { numerator: "1", denominator: "500" } },
      validity: { from: { value: "2026-12-01", precision: "date" } },
    },
  ];
  const datedLookup: unknown = moduleExports.createInferencePriceLookup(dated, mapping);
  if (typeof datedLookup !== "function") throw new Error("Missing dated lookup function");
  const datedReference = createInferencePriceLookup(dated, mapping);
  for (const [evaluated_at, status, denominators] of [
    ["2026-11-17T00:00:00Z", "matched", ["1000"]],
    ["2026-11-30T00:00:00Z", "candidates", ["1000", "500"]],
    ["2026-12-02T00:00:00Z", "candidates", ["500"]],
    ["2026-12-03T00:00:00Z", "matched", ["500"]],
  ] as const) {
    const datedQuery: InferencePriceQuery = { ...query, evaluated_at };
    const expected = datedReference(datedQuery);
    assert.equal(expected.status, status);
    assert.deepEqual(
      expected.candidates
        .flatMap(({ offer }) =>
          offer.terms.flatMap((term) =>
            term.kind === "rate" ? term.variants.map(({ price }) => price.value.denominator) : [],
          ),
        )
        .sort(),
      [...denominators].sort(),
    );
    assert.equal(JSON.stringify(datedLookup(datedQuery)), JSON.stringify(expected), evaluated_at);
  }
}

function rejectNetworkAccess(): never {
  throw new Error("Price lookup attempted network access");
}
