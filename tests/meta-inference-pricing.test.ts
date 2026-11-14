import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { load, type CheerioAPI } from "cheerio";
import { z } from "zod";
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
const emberSections = z.object({ models: z.string(), pricing: z.string() });
function landMarked($: CheerioAPI) {
  $("div[role='main']").each((_, node) => {
    const main = $("<main></main>");
    main.append($(node).contents());
    $(node).replaceWith(main);
  });
  return $;
}
function contributorFirst($: CheerioAPI) {
  $("table").each((_, table) => {
    const rows = $(table)
      .find("tr")
      .toArray()
      .map((row) => $(row).find("th,td").toArray());
    const header = (rows[0] ?? []).map((cell) => $(cell).text().trim());
    const standard = header.indexOf("Standard mode (per 1M tokens)");
    const contributor = header.indexOf("Contributor mode (per 1M tokens)");
    if (standard < 0 || contributor < 0 || standard > contributor) return;
    for (const row of rows) {
      const first = row[standard];
      const second = row[contributor];
      if (!first || !second) continue;
      const standardCell = $(first).clone();
      const contributorCell = $(second).clone();
      $(first).replaceWith(contributorCell);
      $(second).replaceWith(standardCell);
    }
  });
  return $;
}
async function fixture(): Promise<LinkedBundle> {
  const bundle = linkedBundleSchema.parse(
    JSON.parse(
      await readFile(new URL("./fixtures/meta/model-api-current.json", import.meta.url), "utf8"),
    ),
  );
  const ember = emberSections.parse(
    JSON.parse(
      await readFile(new URL("./fixtures/meta/muse-ember-current.json", import.meta.url), "utf8"),
    ),
  );
  const $ = landMarked(load(bundle.index.body));
  for (const family of ["muse-wonder", "muse-spark"]) {
    const table = $(`main #${family}-availability`).nextUntil("h2,h3");
    bundle.documents.push({
      url: `https://dev.meta.ai/docs/${family}`,
      body: `<main><h2 id="availability">Availability</h2>${table
        .toArray()
        .map((node) => $.html(node))
        .join("")}</main>`,
    });
    table.remove();
    $(`main #${family}-availability`).remove();
  }
  $("main").append(ember.models);
  bundle.index.body = $.html();
  const pricing = bundle.documents[0];
  if (!pricing) throw new Error("Missing Meta pricing fixture");
  const pricingPage = contributorFirst(landMarked(load(pricing.body)));
  pricingPage("main").append(ember.pricing);
  pricing.body = pricingPage.html();
  const companions = linkedBundleSchema.shape.documents.parse(
    JSON.parse(
      await readFile(
        new URL("./fixtures/meta/model-metadata-accounting.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  for (const companion of companions) {
    const existing = bundle.documents.find(({ url }) => url === companion.url);
    if (existing === undefined) bundle.documents.push(companion);
    else {
      const page = load(existing.body);
      page("main").append(load(companion.body)("main").html() ?? "");
      existing.body = page.html();
    }
  }
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

function bindings(model_id: string, meter: string, candidate = baseline) {
  return lookup(candidate)({ provider_id: "meta", model_id }).candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === meter
        ? term.variants.flatMap(({ charge_binding }) =>
            charge_binding === undefined ? [] : [charge_binding],
          )
        : [],
    ),
  );
}

it("collects owned model specifications without copying version-specific effort to older models", () => {
  const model = (id: string) => baseline.catalog.models.find(({ model_id }) => model_id === id);
  expect(model("muse-wonder-1.0")).toMatchObject({
    tasks: ["text_generation"],
    modalities: { input: ["text", "image", "video", "audio", "pdf"], output: ["text"] },
    limits: { context_tokens: 1048576 },
    capabilities: {
      reasoning: true,
      effort_control: true,
      tool_call: true,
      structured_output: true,
      streaming: true,
      prompt_cache: true,
    },
  });
  expect(model("muse-ember-1.0")).toMatchObject({
    limits: { context_tokens: 1048576, max_output_tokens: 524288 },
    capabilities: { reasoning: true, effort_control: true },
  });
  expect(model("muse-spark-1.3")?.capabilities.effort_control).toBe(true);
  expect(model("muse-spark-1.2")?.capabilities.effort_control).toBe("unknown");
  expect(model("muse-spark-1.3-contributor")?.capabilities.effort_control).toBe("unknown");
  expect(model("sam-3.1")).toMatchObject({
    tasks: ["segmentation"],
    modalities: { input: ["text", "image", "video"] },
    api_endpoints: [{ name: "Responses", path: "/v1/responses" }],
  });
  expect(baseline.catalog.models.every(({ release_date }) => release_date === undefined)).toBe(
    true,
  );
});

it("binds cached subsets and complete terminal usage without using usage totals for the context tier", () => {
  const input = bindings("muse-spark-1.3", "input_text");
  expect(input[0]?.quantity_methods).toHaveLength(2);
  expect(
    input[0]?.quantity_methods?.every(({ calculation }) =>
      calculation?.nodes.some(({ op }) => op === "subtract_floor_zero"),
    ),
  ).toBe(true);
  const paths = input.flatMap(
    ({ quantity_methods }) =>
      quantity_methods?.flatMap(
        ({ input_sources }) => input_sources?.map(({ locator }) => locator.value) ?? [],
      ) ?? [],
  );
  expect(paths).toEqual(
    expect.arrayContaining([
      "/usage/input_tokens",
      "/usage/prompt_tokens",
      "/response/usage/input_tokens",
      "/usage/prompt_tokens_details/cached_tokens",
    ]),
  );
  expect(
    input
      .flatMap(
        ({ quantity_methods }) =>
          quantity_methods?.flatMap(({ input_sources }) => input_sources ?? []) ?? [],
      )
      .every(({ absent_value }) => absent_value === undefined),
  ).toBe(true);
  const ember = lookup()({ provider_id: "meta", model_id: "muse-ember-1.0" });
  expect(ember.missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "context_tokens",
  });
  expect(
    ember.candidates
      .flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate"
            ? term.variants.flatMap(({ selector_sources }) => selector_sources ?? [])
            : [],
        ),
      )
      .filter(
        ({ dimension }) =>
          dimension.namespace === "kmodels" && dimension.value === "context_tokens",
      ),
  ).toEqual([]);
});

it("reads SAM billed counters and returned image arrays while leaving floored audio seconds caller-owned", () => {
  for (const [meter, pointer] of [
    ["input_image", "images_processed"],
    ["input_video", "video_frames_processed"],
  ]) {
    const methods = bindings("sam-3.1", meter ?? "")[0]?.quantity_methods;
    expect(methods?.flatMap(({ input_sources }) => input_sources ?? [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "response",
          locator: { kind: "json_pointer", value: `/usage/${pointer}` },
        }),
        expect.objectContaining({
          channel: "stream_event",
          availability: "terminal_only",
          locator: { kind: "json_pointer", value: `/response/usage/${pointer}` },
        }),
      ]),
    );
    expect(methods?.every(({ calculation }) => calculation === undefined)).toBe(true);
  }
  expect(
    bindings("muse-image-1.0", "image_generation")[0]?.quantity_methods?.flatMap(
      ({ input_sources }) => input_sources ?? [],
    ),
  ).toEqual([
    expect.objectContaining({
      channel: "response",
      locator: { kind: "json_pointer", value: "/data" },
      reduction: { kind: "array_length" },
    }),
  ]);
  expect(bindings("muse-voice-transcribe-1.0", "input_audio")[0]?.quantity_methods).toBeUndefined();
  expect(prices("muse-image-1.0", "output_text")).toEqual([]);
});

it("withholds only a malformed native counter and keeps prices and independent protocols", async () => {
  const candidate = await collect((bundle) => {
    const doc = bundle.documents.find(({ url }) => url.endsWith("responses/schemas.md"));
    if (!doc) throw Error("Missing response schema");
    doc.body = doc.body.replace(
      /(\| `input_tokens_details.cached_tokens`\s*\|\s*)`integer`/,
      "$1`string`",
    );
  });
  const paths = bindings("muse-spark-1.3", "input_text", candidate)[0]?.quantity_methods?.flatMap(
    ({ input_sources }) => input_sources?.map(({ locator }) => locator.value) ?? [],
  );
  expect(paths).toContain("/usage/prompt_tokens");
  expect(paths).toContain("/usage/input_tokens");
  expect(paths).not.toContain("/usage/input_tokens_details/cached_tokens");
  expect(paths).not.toContain("/response/usage/input_tokens_details/cached_tokens");
  expect(prices("muse-spark-1.3", "input_text", candidate)).toEqual(
    prices("muse-spark-1.3", "input_text"),
  );
  expect(bindings("sam-3.1", "input_video", candidate)[0]?.quantity_methods).toBeDefined();
});

it("requires the owned SSE union rather than an unrelated terminal event definition", async () => {
  const candidate = await collect((bundle) => {
    const doc = bundle.documents.find(({ url }) => url.endsWith("responses/schemas.md"));
    if (!doc) throw Error("Missing response schema");
    doc.body = doc.body.replace(
      /(### Response Stream Wire Event[\s\S]*?)\[`ResponseCompletedEvent`\]\([^)]*\)/,
      "$1`UnsupportedEvent`",
    );
  });
  const sources = bindings(
    "muse-spark-1.3",
    "output_text",
    candidate,
  )[0]?.quantity_methods?.flatMap(({ input_sources }) => input_sources ?? []);
  expect(sources?.some(({ locator }) => locator.value.startsWith("/response/"))).toBe(false);
  expect(
    sources?.some(
      ({ channel, locator }) => channel === "response" && locator.value === "/usage/output_tokens",
    ),
  ).toBe(true);
});

it("isolates missing and duplicate optional metadata while retaining exact identity and prices", async () => {
  const candidate = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(({ url }) => !url.endsWith("/muse-ember"));
    const cache = bundle.documents.find(({ url }) => url.endsWith("/prompt-caching.md"));
    if (!cache) throw Error("Missing cache guide");
    bundle.documents.push(cache);
    const wonder = bundle.documents.find(({ url }) => url.endsWith("/muse-wonder"));
    if (!wonder) throw Error("Missing Wonder");
    const page = load(wonder.body);
    const cell = page("#at-a-glance")
      .nextUntil("h2,h3")
      .find("tr")
      .filter((_, node) => page(node).find("th,td").first().text() === "Endpoints")
      .find("td")
      .last();
    cell.prepend("Unsupported ");
    wonder.body = page.html();
  });
  expect(
    candidate.catalog.models.find(({ model_id }) => model_id === "muse-ember-1.0")?.limits,
  ).toEqual({});
  expect(bindings("muse-spark-1.3", "input_text", candidate)[0]?.quantity_methods).toBeUndefined();
  expect(bindings("muse-spark-1.3", "output_text", candidate)[0]?.quantity_methods).toBeDefined();
  expect(
    candidate.catalog.models
      .find(({ model_id }) => model_id === "muse-wonder-1.0")
      ?.api_endpoints?.some(({ path }) => path === "/v1/responses"),
  ).toBe(false);
  expect(prices("muse-ember-1.0", "input_text", candidate)).toEqual(
    prices("muse-ember-1.0", "input_text"),
  );
});

it("uses exact Standard and Contributor IDs without asking for a redundant pricing mode", () => {
  expect(baseline.catalog.providers).toMatchObject([
    { id: "meta", name: "Meta", kind: "hosted", source_ids: ["meta-model-api"] },
  ]);
  expect(baseline.catalog.models.map(({ model_id }) => model_id).sort()).toEqual([
    "muse-ember-1.0",
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
  expect(baseline.inference?.mapping.rules).toHaveLength(10);
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

it("prices Muse Ember by the documented 200K input-token tiers in Standard mode only", () => {
  const tiers: { tokens: string; input: string; cached: string; output: string }[] = [
    { tokens: "150000", input: "1/10000000", cached: "1/250000000", output: "1/2000000" },
    { tokens: "250000", input: "3/10000000", cached: "3/250000000", output: "3/2000000" },
  ];
  for (const { tokens, input, cached, output } of tiers) {
    for (const [meter, value] of [
      ["input_text", input],
      ["cache_read_text", cached],
      ["output_text", output],
    ] as const) {
      const [numerator, denominator] = value.split("/");
      const result = lookup()({
        provider_id: "meta",
        model_id: "muse-ember-1.0",
        meter: { namespace: "kmodels", value: meter },
        selectors: [
          {
            kind: "decimal",
            dimension: { namespace: "kmodels", value: "context_tokens" },
            value: tokens,
            unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
          },
        ],
      });
      expect(result.missing_conditions).toEqual([]);
      const terms = result.candidates.flatMap(({ offer }) => offer.terms);
      expect(terms).toHaveLength(1);
      expect(terms[0]).toMatchObject({
        kind: "rate",
        variants: [{ price: { value: { numerator, denominator } } }],
      });
    }
  }
  expect(prices("muse-ember-1.0", "input_text")).toEqual([
    { numerator: "1", denominator: "10000000" },
    { numerator: "3", denominator: "10000000" },
  ]);
});

it("accepts the current main landmark and Contributor-first pricing columns", async () => {
  const bundle = await fixture();
  expect(bundle.index.body).toContain("<main>");
  expect(bundle.index.body).not.toContain('role="main"');
  expect(bundle.documents[0]?.body).not.toContain('role="main"');
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
    ["Over 200K input tokens (per 1M tokens)", "Over 500K input tokens (per 1M tokens)"],
    [
      "Model: <code>muse-ember-1.0</code>, in Standard mode only.",
      "Model: <code>muse-ember-1.0</code>, in Contributor mode only.",
    ],
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
