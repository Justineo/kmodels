import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { linkedBundleSchema, type LinkedBundle } from "../src/catalog/bundle.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests, type ProviderManifest } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import type { Catalog } from "../src/catalog/schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T19:00:00.000Z";
const configured = manifests.find(({ provider }) => provider.id === "meta");
const source = configured?.sources.find(({ id }) => id === "meta-model-api");
if (!configured || !source) throw new Error("Missing Meta Model API source");
const manifest: ProviderManifest = configured;
async function fixture(): Promise<LinkedBundle> {
  const bundle = linkedBundleSchema.parse(
    JSON.parse(
      await readFile(new URL("./fixtures/meta/model-api-current.json", import.meta.url), "utf8"),
    ),
  );
  const $ = load(bundle.index.body);
  for (const family of ["muse-wonder", "muse-spark"]) {
    const table = $(`[role="main"] #${family}-availability`).nextUntil("h2,h3");
    bundle.documents.push({
      url: `https://dev.meta.ai/docs/${family}`,
      body: `<main role="main"><h2 id="availability">Availability</h2>${table
        .toArray()
        .map((node) => $.html(node))
        .join("")}</main>`,
    });
    table.remove();
    $(`[role="main"] #${family}-availability`).remove();
  }
  bundle.index.body = $.html();
  return bundle;
}
async function collect(change?: (bundle: LinkedBundle) => void, previous?: CatalogPairCandidate) {
  const bundle = await fixture();
  change?.(bundle);
  const body = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
  const result = await collectProvider(manifest, previous?.catalog, { sources: {} }, at);
  if (!result.pricing) throw new Error(JSON.stringify(result.attempt));
  const core: Catalog = {
    catalog_version: coreCatalogVersion([result.provider]),
    generated_at: at,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
  };
  const pair = composeCatalogPair(
    previous?.catalog,
    core,
    previous?.pricing.data ?? emptyPricingCatalog(),
    [{ kind: "fresh", partition: result.pricing }],
  );
  return compileInferencePriceMapping(
    prepareCatalogPair(pair.catalog, pair.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}
let baseline: CatalogPairCandidate;
beforeAll(async () => {
  baseline = await collect();
});
function lookup(candidate = baseline) {
  return createInferencePriceLookup(
    priceDataExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}
function prices(model_id: string, meter: string, candidate = baseline) {
  return lookup(candidate)({ provider_id: "meta", model_id }).candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === meter
        ? term.variants.map(({ price }) => price.value)
        : [],
    ),
  );
}

it("uses exact Standard and Contributor IDs without asking for a redundant pricing mode", () => {
  expect(baseline.catalog.providers).toMatchObject([
    { id: "meta", name: "Meta", kind: "hosted", source_ids: ["meta-model-api"] },
  ]);
  expect(baseline.catalog.models.map(({ model_id }) => model_id).sort()).toEqual([
    "muse-image-1.0",
    "muse-spark-1.1",
    "muse-spark-1.2",
    "muse-spark-1.2-contributor",
    "muse-spark-1.3",
    "muse-spark-1.3-contributor",
    "muse-voice-transcribe-1.0",
    "muse-wonder-1.0",
    "sam-3.1",
  ]);
  expect(baseline.inference?.mapping.rules).toHaveLength(9);
  for (const model_id of ["muse-spark-1.3", "muse-spark-1.3-contributor", "muse-wonder-1.0"]) {
    const result = lookup()({ provider_id: "meta", model_id });
    expect(result.status).toBe("matched");
    expect(result.missing_conditions).toEqual([]);
  }
  expect(prices("muse-spark-1.3", "input_text")).toEqual([
    { numerator: "1", denominator: "800000" },
  ]);
  expect(prices("muse-spark-1.3-contributor", "input_text")).toEqual([
    { numerator: "1", denominator: "10000000" },
  ]);
  expect(prices("muse-wonder-1.0", "output_text")).toEqual([
    { numerator: "1", denominator: "50000" },
  ]);
  expect(prices("muse-spark-1.2-contributor", "cache_read_text")).toEqual([
    { numerator: "1", denominator: "500000000" },
  ]);
});

it("preserves media units and binds billable quantities, including the frame minimum", () => {
  expect(prices("muse-image-1.0", "image_generation")).toEqual([
    { numerator: "1", denominator: "100" },
  ]);
  expect(prices("muse-voice-transcribe-1.0", "input_audio")).toEqual([
    { numerator: "1", denominator: "20000" },
  ]);
  expect(prices("sam-3.1", "input_image")).toEqual([{ numerator: "1", denominator: "400" }]);
  expect(prices("sam-3.1", "input_video")).toEqual([{ numerator: "1", denominator: "5000" }]);
  const terms = baseline.pricing.data.books.flatMap(({ offers }) =>
    offers.flatMap(({ terms }) => terms),
  );
  const frames = terms.find((term) => term.kind === "rate" && term.meter.value === "input_video");
  if (frames?.kind !== "rate") throw new Error("Missing frame rate");
  expect(frames.variants[0]?.charge_binding?.signal).toEqual({
    namespace: "provider",
    provider_id: "meta",
    value: "billed_video_frames",
  });
  expect(JSON.stringify(frames)).toContain("minimum 50");
  expect(
    baseline.catalog.models.find(({ model_id }) => model_id === "sam-3.1")?.description,
  ).toContain("at least 50 frames");
});

it("keeps text search independent of base model rates and image generation", () => {
  const search = baseline.pricing.data.books.find(({ book_key }) => book_key === "web-search");
  expect(search?.scope.kind).toBe("provider_resource");
  for (const model_id of ["muse-spark-1.3", "muse-image-1.0"])
    expect(prices(model_id, "web_search")).toEqual([]);
});

it("does not borrow hosted prices for artifacts, partners, private names or guessed suffixes", () => {
  for (const model_id of [
    "Llama-3.3-70B-Instruct",
    "muse-spark-open",
    "muse-glimmer",
    "muse-wonder-1.0-contributor",
    "muse-spark-1.1-contributor",
    "us.muse-spark-1.3",
    "my-deployment",
  ])
    expect(lookup()({ provider_id: "meta", model_id }).reason).toBe("unreviewed_id");
  const other = lookup()({ provider_id: "meta", model_id: "muse-image-1.0" }).candidates[0]?.offer
    .id;
  expect(other).toBeDefined();
  expect(
    lookup()({ provider_id: "meta", model_id: "muse-spark-1.3", offer_ref: other }).reason,
  ).toBe("no_applicable_price");
});

it("withdraws a price association when the current price declaration drops that ID", async () => {
  const candidate = await collect((bundle) => {
    const document = bundle.documents[0];
    if (!document) throw new Error("Missing pricing fixture");
    const $ = load(document.body);
    $("#muse-spark-pricing")
      .next("p")
      .find("code")
      .filter((_, node) => $(node).text() === "muse-spark-1.1")
      .remove();
    document.body = $.html();
  }, baseline);
  expect(candidate.catalog.models.some(({ model_id }) => model_id === "muse-spark-1.1")).toBe(true);
  expect(lookup(candidate)({ provider_id: "meta", model_id: "muse-spark-1.1" }).reason).toBe(
    "unreviewed_id",
  );
  expect(lookup(candidate)({ provider_id: "meta", model_id: "muse-spark-1.3" }).status).toBe(
    "matched",
  );
});

it("detects commercial drift instead of silently swapping modes or losing media accounting", async () => {
  const provider = baseline.catalog.providers[0];
  if (!provider || !source) throw new Error("Missing provider");
  for (const [from, to] of [
    ["in Standard mode;", "in Contributor mode;"],
    ["rounded down to whole seconds", "rounded up to whole minutes"],
    ["at least 50 frames", "at least 100 frames"],
    ["Video segmentation</td>", "Image segmentation</td>"],
    ["per 1M tokens", "per 1K tokens"],
  ]) {
    const bundle = await fixture();
    const document = bundle.documents[0];
    if (!document || !from || !to) throw new Error("Missing fixture");
    expect(document.body).toContain(from);
    document.body = document.body.replaceAll(from, to);
    expect(() =>
      parseSource({ provider, source, body: JSON.stringify(bundle), observedAt: at }),
    ).toThrow();
  }
});

it("requires each model page to establish its exact hosted availability", async () => {
  const bundle = await fixture();
  const provider = baseline.catalog.providers[0];
  if (!provider || !source) throw new Error("Missing provider");
  bundle.documents = bundle.documents.filter(({ url }) => !url.endsWith("/muse-spark"));
  expect(() =>
    parseSource({ provider, source, body: JSON.stringify(bundle), observedAt: at }),
  ).toThrow("Missing Meta model page /docs/muse-spark");
});

it("exports the same direct ID lookup to the website without protocol or audit payloads", async () => {
  const projected = await projectCatalogPair(baseline);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()))
        .details.map(restoreWebsiteInferenceDetail),
    );
  const price = details.find(({ model_ref }) => model_ref === "meta/muse-spark-1.3-contributor")
    ?.inference_prices?.[0];
  if (!price) throw new Error("Missing Meta website price");
  expect(price.model_id).toBe("muse-spark-1.3-contributor");
  expect(queryWebsiteInferencePrice(price, [], at).status).toBe("matched");
  expect(price.pricing_options ?? []).toEqual([]);
  expect(JSON.stringify(price)).not.toMatch(/content_hash|invocation_target|api\.meta\.ai/);
});

it("does not carry a version-specific SAM tariff to a new hosted model version", async () => {
  const bundle = await fixture();
  const provider = baseline.catalog.providers[0];
  if (!provider || !source) throw new Error("Missing provider");
  bundle.index.body = bundle.index.body.replaceAll("sam-3.1", "sam-3.2");
  for (const document of bundle.documents)
    document.body = document.body.replaceAll("sam-3.1", "sam-3.2");
  expect(() =>
    parseSource({ provider, source, body: JSON.stringify(bundle), observedAt: at }),
  ).toThrow("tariff version changed");
});
