import { readFile } from "node:fs/promises";
import { collect } from "../src/catalog/collector.ts";
import { parseIJson } from "../src/catalog/canonical-json.ts";
import { parsePricingReleaseInput } from "../src/catalog/pricing-release.ts";

const jitter = Number(process.env.KMODELS_JITTER_MS ?? "0");
const rebuildProvider = process.env.KMODELS_REBUILD_PROVIDER;
const releaseInputPath = process.env.KMODELS_PRICING_RELEASE_INPUT;
const releaseInput =
  releaseInputPath === undefined
    ? undefined
    : parsePricingReleaseInput(parseIJson(await readFile(releaseInputPath), 65_536));
const catalog = await collect({
  jitterMs: Number.isFinite(jitter) ? Math.max(jitter, 0) : 0,
  rebuild: process.env.KMODELS_REBUILD === "1",
  ...(rebuildProvider === undefined ? {} : { rebuildProvider }),
  ...(releaseInput === undefined
    ? {}
    : {
        pricingTransitions: releaseInput.transitions,
        pricingSafetyFindings: releaseInput.safety_findings,
      }),
});
const fresh = catalog.coverage.filter((coverage) => coverage.status === "fresh").length;
const stale = catalog.coverage.filter((coverage) => coverage.status === "stale").length;

console.log(
  `Published ${catalog.models.length} models from ${fresh} fresh providers (${stale} stale), ${catalog.catalog_version.slice(0, 12)}`,
);
