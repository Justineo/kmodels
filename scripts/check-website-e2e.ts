import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { preview } from "vite-plus";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";

const distDir = resolve("dist");

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

// Start with the first row of a large detail chunk to exercise deferred loading.
const chunks = await readdir(join(distDir, "ui/details"), { recursive: true, withFileTypes: true });
const rankedChunks = await Promise.all(
  chunks
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path, size: (await stat(path)).size };
    }),
);
const largest = rankedChunks.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))[0];
assert(largest, "Expected at least one built detail chunk");
const details = websiteDetailChunkSchema.parse(JSON.parse(await readFile(largest.path, "utf8")));
const modelRef = details.details[0]?.model_ref;
assert(modelRef, `Expected a model in ${largest.path}`);

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

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const rows = page.locator("tbody tr.model-row, tbody tr.model-group-row");
  await rows.first().waitFor({ state: "visible", timeout: 15_000 });

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
  await rows.first().waitFor({ state: "visible", timeout: 10_000 });

  const dialog = page.locator("dialog.details-dialog[open]");
  await page.goto(`${origin}?m=${encodeURIComponent(modelRef)}`, { waitUntil: "domcontentloaded" });
  await dialog.locator("#modalities-heading").waitFor({ state: "visible", timeout: 15_000 });
  await dialog.locator("#pricing-heading").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });

  assert.equal(consoleErrors.length, 0, `Unexpected console errors: ${consoleErrors.join("; ")}`);
  assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join("; ")}`);
  console.log(
    "Verified built website search, result recovery, deferred details and browser bundles.",
  );
} finally {
  await browser?.close();
  server.httpServer.close();
}
