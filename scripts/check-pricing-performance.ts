import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { build, preview } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import {
  readPublishedAssetProfile,
  readCompressedProfileAsset,
} from "../src/catalog/published-assets.ts";
import {
  websiteDetailChunkSchema,
  websiteOfferChunkSchema,
} from "../src/catalog/website-schema.ts";
import { restoreInferencePrices } from "../src/catalog/website-inference-storage.ts";
import {
  pricingPerformanceFixture,
  type PricingPerformanceCase,
} from "../tests/performance/pricing-fixture.ts";
import {
  pricingPerformanceBudgets,
  timingFailures,
  timingSummary,
} from "./pricing-performance-contract.ts";
import type {} from "../tests/performance/pricing-browser.ts";

type State = Awaited<ReturnType<Window["pricingBenchmark"]["mount"]>>;
const reportPath = resolve(
  process.env.PRICING_PERFORMANCE_REPORT ?? "node_modules/.cache/pricing-performance/report.json",
);
const reports: unknown[] = [];
const failures: string[] = [];
const output = await mkdtemp(join(tmpdir(), "kmodels-pricing-performance-"));
let browser: Browser | undefined;
let server: Awaited<ReturnType<typeof preview>> | undefined;

async function catalogCases(): Promise<{ version: string; cases: PricingPerformanceCase[] }> {
  const published = await readPublishedAssetProfile("ui");
  const read = (path: string): unknown => {
    const bytes = readCompressedProfileAsset(published, path);
    if (bytes === undefined) throw new Error(`Missing published asset ${path}`);
    return JSON.parse(gunzipSync(bytes).toString("utf8"));
  };
  const ranked = new Map<
    string,
    {
      score: number;
      subject: PricingPerformanceCase;
      provider: string;
      references: [number, number][];
    }
  >();
  for (const asset of published.manifest.assets) {
    if (!asset.file_name.startsWith("ui/details/")) continue;
    const chunk = websiteDetailChunkSchema.parse(read(`/${asset.file_name}`));
    for (const detail of chunk.details) {
      for (const price of restoreInferencePrices(detail.inference_prices ?? [])) {
        const claims = price.matching?.offers.flatMap((offer) => offer.selection ?? []) ?? [];
        if (!claims.some(({ alternatives }) => alternatives.length > 0)) continue;
        const score = claims.reduce(
          (sum, claim) =>
            sum + claim.applicability.any_of.reduce((n, clause) => n + clause.all_of.length, 0),
          0,
        );
        if ((ranked.get(detail.model_ref)?.score ?? -1) >= score) continue;
        ranked.set(detail.model_ref, {
          score,
          subject: {
            name: `${chunk.provider_id}/${price.model_id}`,
            modelRef: detail.model_ref,
            prices: [price],
            offers: [],
          },
          provider: chunk.provider_id,
          references: detail.pricing?.offer_refs ?? [],
        });
      }
    }
  }
  const cases = [...ranked.values()]
    .sort((a, b) => b.score - a.score || a.subject.name.localeCompare(b.subject.name))
    .slice(0, 5)
    .map(({ subject, provider, references }) => ({
      ...subject,
      offers: references.map(([chunk, index]) => {
        const offer = websiteOfferChunkSchema.parse(read(`/ui/offers/${provider}/${chunk}.json`))
          .offers[index];
        if (offer === undefined)
          throw new Error(`Missing published offer ${provider}/${chunk}/${index}`);
        return offer;
      }),
    }));
  return { version: published.manifest.data_version, cases };
}

async function change(page: Page, state: State, suffix: string, label: string): Promise<State> {
  const control = state.controls.find(
    ({ id, label }) => id.endsWith(suffix) || label.toLowerCase() === suffix,
  );
  assert(control, `Missing control ${suffix}: ${JSON.stringify(state.controls)}`);
  const option = control.options.find((value) => value.label === label && !value.disabled);
  assert(option, `Missing ${label} option in ${suffix}`);
  return page.evaluate(({ id, value }) => window.pricingBenchmark.select(id, value), {
    id: control.id,
    value: option.value,
  });
}

async function measure(
  subject: PricingPerformanceCase,
  mode: "inference" | "offer",
  synthetic: boolean,
  origin: string,
) {
  assert(browser);
  const name = `${subject.name}/${mode}`;
  const mounts: number[] = [];
  const first: number[] = [];
  const updates = new Map<string, number[]>();
  const frameSamples: number[] = [];
  for (let cold = 0; cold < (synthetic ? 3 : 1); cold++) {
    const context: BrowserContext = await browser.newContext();
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const page: Page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}/tests/performance/index.html`);
      await page.waitForFunction(() => window.pricingBenchmark !== undefined);
      let state: State = await page.evaluate(
        ({ subject, mode }) => window.pricingBenchmark.mount(subject, mode),
        { subject, mode },
      );
      mounts.push(state.update_ms);
      assert(
        state.update_ms <= pricingPerformanceBudgets.mount_ms,
        `${name} cold mount: ${state.update_ms.toFixed(1)} ms exceeds ${pricingPerformanceBudgets.mount_ms} ms`,
      );
      const record = (action: string, next: State) => {
        const samples = updates.get(action) ?? [];
        samples.push(next.update_ms);
        updates.set(action, samples);
        frameSamples.push(next.frame_ms);
        state = next;
      };
      if (synthetic) {
        const edit = async (action: string, suffix: string, label: string) =>
          record(action, await change(page, state, suffix, label));
        await edit("priority", "-service_tier", "Priority");
        first.push(state.update_ms);
        assert(
          state.update_ms <= pricingPerformanceBudgets.first_update_ms,
          `${name} first update: ${state.update_ms.toFixed(1)} ms exceeds ${pricingPerformanceBudgets.first_update_ms} ms`,
        );
        assert(!state.controls.some(({ id }) => id.endsWith("-speed")));
        for (let repeat = 0; repeat < 6; repeat++) {
          await edit("standard", "-service_tier", "Standard");
          await edit("optimized", "-speed", "Latency optimized");
          await edit("region", "region", repeat % 2 === 0 ? "region-0" : "region-1");
          await edit("priority-with-speed", "-service_tier", "Priority");
          assert(!state.controls.some(({ id }) => id.endsWith("-speed")));
          assert(
            state.controls.some(
              ({ label, value }) =>
                label.toLowerCase() === "region" && value.includes(`region-${repeat % 2}`),
            ),
            `Region selection must survive: ${JSON.stringify(state)}`,
          );
          assert.deepEqual(
            state.rates,
            Array.from({ length: 2 }, () => `$${2 + (repeat % 2)}`),
            "Both tariffs must resolve for the selected region during the timed interaction",
          );
          await edit("flex", "-service_tier", "Flex");
          await edit("standard-return", "-service_tier", "Standard");
          await edit("standard-speed", "-speed", "Standard");
        }
      } else {
        const seen = new Set<string>();
        for (let step = 0; step < 12; step++) {
          const next = state.controls
            .flatMap((control) =>
              control.options
                .filter(({ disabled }) => !disabled)
                .slice(0, 2)
                .map((option) => ({ id: control.id, control: control.label, ...option })),
            )
            .find(
              ({ id, value }) =>
                !seen.has(`${id}:${value}`) &&
                state.controls.find((control) => control.id === id)?.value !== value,
            );
          if (next === undefined) break;
          seen.add(`${next.id}:${next.value}`);
          record(
            `${next.control} (${next.id})`,
            await page.evaluate(({ id, value }) => window.pricingBenchmark.select(id, value), next),
          );
          if (step === 0) first.push(state.update_ms);
        }
      }
      assert.deepEqual(errors, [], "Browser errors invalidate timing results");
    } catch (error) {
      reports.push({ name, mounts, first, updates: Object.fromEntries(updates) });
      await page.screenshot({ path: join(dirname(reportPath), `failure-${reports.length}.png`) });
      throw error;
    } finally {
      await context.close();
    }
  }
  const result = {
    name,
    mounts,
    first,
    updates: Object.fromEntries(
      [...updates].map(([action, samples]) => [action, { ...timingSummary(samples), samples }]),
    ),
    frame: frameSamples.length ? timingSummary(frameSamples) : null,
  };
  reports.push(result);
  const exceeded = timingFailures(name, mounts, first, updates);
  failures.push(...exceeded);
  console.log(
    JSON.stringify({
      name,
      mount_ms: Math.max(...mounts),
      worst_update_ms: Math.max(0, ...[...updates.values()].flat()),
      failures: exceeded,
    }),
  );
}

try {
  await mkdir(dirname(reportPath), { recursive: true });
  await build({
    configFile: false,
    plugins: [vue()],
    logLevel: "warn",
    build: {
      outDir: output,
      emptyOutDir: true,
      rollupOptions: { input: resolve("tests/performance/index.html") },
    },
  });
  server = await preview({
    configFile: false,
    logLevel: "warn",
    build: { outDir: output },
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing benchmark server address");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  for (const mode of ["inference", "offer"] as const)
    await measure(pricingPerformanceFixture(), mode, true, origin);
  const page = await browser.newPage();
  const transitionErrors: string[] = [];
  page.on("pageerror", (error) => transitionErrors.push(error.message));
  await page.goto(`${origin}/tests/performance/index.html`);
  for (const mode of ["inference", "offer"] as const) {
    try {
      const transitions = await page.evaluate(
        ({ subject, mode }) => window.pricingBenchmark.audit(subject, mode),
        { subject: pricingPerformanceFixture(4, true), mode },
      );
      assert.deepEqual(transitionErrors, [], "Browser errors invalidate transition results");
      reports.push({ name: `regional-transitions/${mode}`, ...transitions });
      console.log(JSON.stringify({ name: `regional-transitions/${mode}`, ...transitions }));
    } catch (error) {
      await page.screenshot({ path: join(dirname(reportPath), `failure-transitions-${mode}.png`) });
      throw error;
    }
  }
  await page.close();
  if (!process.argv.includes("--fixture-only")) {
    const catalog = await catalogCases();
    reports.push({
      catalog_version: catalog.version,
      selected_models: catalog.cases.map(({ name }) => name),
    });
    for (const subject of catalog.cases) await measure(subject, "inference", false, origin);
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        node: process.version,
        browser: browser?.version(),
        budgets: pricingPerformanceBudgets,
        reports,
        failures,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await server?.close();
  await rm(output, { recursive: true, force: true });
}
