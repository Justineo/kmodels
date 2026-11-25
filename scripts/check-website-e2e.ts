import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { preview } from "vite-plus";
import {
  projectWebsitePricingTimeline,
  projectWebsiteRateQuery,
} from "../src/catalog/website-pricing-query.ts";
import {
  websiteDetailChunkSchema,
  websiteOfferChunkSchema,
} from "../src/catalog/website-schema.ts";

const distDir = resolve("dist");
const distIndex = join(distDir, "index.html");
await access(distIndex);

// Verify the actual built browser JS bundle graph contains zero Zod runtime code.
const assetDir = join(distDir, "assets");
const jsAssets = (await readdir(assetDir)).filter((name) => name.endsWith(".js"));
assert(jsAssets.length > 0, "Expected built JS assets in dist/assets");
for (const file of jsAssets) {
  const source = await readFile(join(assetDir, file), "utf8");
  assert(
    !/\b(?:ZodError|ZodType|ZodObject)\b/.test(source) && !source.includes("zod/v4"),
    `Built browser asset ${file} unexpectedly bundles Zod runtime code`,
  );
}

// Identify the first model in Hugging Face detail chunk 0 (largest chunk > 1,000 models)
// so we verify F04 never regresses on real production assets.
const hfChunk0 = websiteDetailChunkSchema.parse(
  JSON.parse(await readFile(join(distDir, "ui/details/huggingface/0.json"), "utf8")),
);
const firstHfModelRef = hfChunk0.details[0]?.model_ref;
assert(firstHfModelRef, "Expected at least one model in Hugging Face detail chunk 0");
const firstHfModelId = firstHfModelRef.replace(/^huggingface\//, "");

// Verify built xai/grok-imagine-image-pro preserves its default (empty-selection) invariant
// $0.01 input image rate without explicit numeric states (F05 default-selection guard).
const xaiDetailFiles = (await readdir(join(distDir, "ui/details/xai"))).filter((f) =>
  f.endsWith(".json"),
);
const evaluatedAt = new Date().toISOString();
let foundXaiDefaultRate = false;
for (const file of xaiDetailFiles) {
  const chunk = websiteDetailChunkSchema.parse(
    JSON.parse(await readFile(join(distDir, "ui/details/xai", file), "utf8")),
  );
  const target = chunk.details.find((d) => d.model_ref === "xai/grok-imagine-image-pro");
  if (!target?.pricing?.offer_refs.length) continue;
  for (const [offerChunkIdx, offerIdx] of target.pricing.offer_refs) {
    const offerChunk = websiteOfferChunkSchema.parse(
      JSON.parse(await readFile(join(distDir, `ui/offers/xai/${offerChunkIdx}.json`), "utf8")),
    );
    const offer = offerChunk.offers[offerIdx];
    if (!offer) continue;
    const current = projectWebsitePricingTimeline(offer, evaluatedAt).current;
    const defaultRates = projectWebsiteRateQuery(current, target.model_ref, []).rates;
    if (defaultRates.some(({ row }) => row.amount === "$0.01")) {
      foundXaiDefaultRate = true;
      break;
    }
  }
  if (foundXaiDefaultRate) break;
}
assert(
  foundXaiDefaultRate,
  "Expected built xai/grok-imagine-image-pro to project $0.01 rate under empty default selections",
);

const server = await preview({
  configFile: false,
  preview: { host: "127.0.0.1", port: 0, strictPort: false },
  build: { outDir: "dist" },
});
let browser: Browser | undefined;

try {
  const origin = server.resolvedUrls?.local[0];
  assert(origin, "Preview server did not report a local URL");
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(origin, { waitUntil: "networkidle" });
  const rows = page.locator("tbody tr.model-row, tbody tr.model-group-row");
  await rows.first().waitFor({ state: "visible", timeout: 15_000 });
  const initialRowCount = await rows.count();
  assert(initialRowCount > 0, "Expected catalog rows to render on initial load");

  // 1. Verify search updates query string via replaceState without pushing history entries.
  const searchInput = page.locator('input[type="search"]');
  const historyBefore = await page.evaluate(() => history.length);
  await searchInput.fill("claude");
  await page.waitForFunction(() => location.search.includes("q=claude"));
  const historyAfter = await page.evaluate(() => history.length);
  assert.equal(
    historyAfter,
    historyBefore,
    "Typing in search must use replaceState rather than pushState",
  );

  // 2. Verify zero-results transition and recovery keep virtual table responsive to resize.
  await searchInput.fill("zzzz-nonexistent-kmodels-query-99999");
  await page.locator(".table-state").waitFor({ state: "visible", timeout: 10_000 });
  await searchInput.fill("");
  await rows.first().waitFor({ state: "visible", timeout: 10_000 });
  await page.setViewportSize({ width: 1440, height: 600 });
  const resizedCount = await rows.count();
  assert(resizedCount > 0, "Expected table rows to remain rendered after zero-results recovery");

  const dialog = page.locator("dialog.details-dialog[open]");
  const withModelDrawer = async (modelRef: string, verify: () => Promise<void>) => {
    await page.goto(`${origin}?m=${encodeURIComponent(modelRef)}`, { waitUntil: "networkidle" });
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await dialog.locator("#pricing-heading").waitFor({ state: "visible", timeout: 15_000 });
    await verify();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  };

  // 3. Verify opening the FIRST model in Hugging Face's >1,000-model chunk 0 succeeds (F04 guard).
  await withModelDrawer(firstHfModelRef, async () => {
    const hfDrawerText = await dialog.innerText();
    assert(
      hfDrawerText.includes(firstHfModelId) &&
        !hfDrawerText.includes("does not contain this model"),
      `Expected first Hugging Face chunk-0 model (${firstHfModelRef}) to load cleanly`,
    );
  });

  // 4. Verify xai/grok-imagine-image-pro displays its $0.01 input image rate after selecting a resolution (F05 guard).
  await withModelDrawer("xai/grok-imagine-image-pro", async () => {
    await dialog.getByText("1K", { exact: true }).click();
    await dialog.getByText("$0.01").first().waitFor({ state: "visible", timeout: 15_000 });
  });

  assert.equal(consoleErrors.length, 0, `Unexpected console errors: ${consoleErrors.join("; ")}`);
  assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join("; ")}`);
  console.log(
    `Website E2E passed: ${initialRowCount} initial rows, replaceState search, zero-results recovery, HF chunk-0 first model (${firstHfModelRef}), xAI $0.01 invariant rate, zero Zod in ${jsAssets.length} JS bundles, zero runtime errors.`,
  );
} finally {
  await browser?.close();
  server.httpServer.close();
}
