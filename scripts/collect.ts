import { collect } from "../src/catalog/collector.ts";

const jitter = Number(process.env.KMODELS_JITTER_MS ?? "0");
const catalog = await collect({
  jitterMs: Number.isFinite(jitter) ? Math.max(jitter, 0) : 0,
  rebuild: process.env.KMODELS_REBUILD === "1",
});
const fresh = catalog.coverage.filter((coverage) => coverage.status === "fresh").length;
const stale = catalog.coverage.filter((coverage) => coverage.status === "stale").length;

console.log(
  `Published ${catalog.models.length} models from ${fresh} fresh providers (${stale} stale), ${catalog.catalog_version.slice(0, 12)}`,
);
