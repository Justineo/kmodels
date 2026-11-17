import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { dashscopeInferenceFixture } from "./dashscope-inference-fixture.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { parseSource } from "../src/catalog/adapters.ts";
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
import type { Selector } from "../src/pricing/schema.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import { fixedPricingSelections } from "../src/catalog/pricing-selector-input.ts";
import InferencePrices from "../src/components/InferencePrices.vue";
import { renderComponent } from "./render-component.ts";
import { websiteModelDetail } from "../src/catalog/website-data.ts";
import { websiteInferencePrices } from "../src/catalog/website-inference-pricing.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T20:00:00.000Z";
const manifest: ProviderManifest | undefined = manifests.find(
  ({ provider }) => provider.id === "dashscope",
);
const source = manifest?.sources.find(({ id }) => id === "dashscope-pricing");
if (!manifest || !source) throw new Error("Missing DashScope source");
async function collect(
  change?: (bundles: Map<string, LinkedBundle>) => void,
  previous?: CatalogPairCandidate,
) {
  const bundles = await dashscopeInferenceFixture();
  change?.(bundles);
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const bundle = bundles.get(source.id);
    if (!bundle) throw new Error("Missing fixture " + source.id);
    const body = JSON.stringify(bundle);
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  if (!manifest || !source || manifest.notConfiguredReason !== undefined)
    throw new Error("Missing DashScope source");
  const result = await collectProvider(
    {
      ...manifest,
      sources: [
        ...manifest.sources.filter(
          (candidate) => bundles.has(candidate.id) && candidate.id !== source.id,
        ),
        source,
      ],
    },
    previous?.catalog,
    { sources: {} },
    at,
  );
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
}, 15000);
function lookup(candidate = baseline) {
  return createInferencePriceLookup(
    priceDataExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

function condition(
  dimension: "deployment_scope" | "region" | "operation",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "dashscope", value },
  };
}
function context(value: string): Selector {
  return {
    kind: "decimal",
    dimension: { namespace: "kmodels", value: "context_tokens" },
    value,
    unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
  };
}
function cacheMode(value: string): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "provider", provider_id: "dashscope", value: "cache_mode" },
    value: { namespace: "provider", provider_id: "dashscope", value },
  };
}
const globalUS = [
  condition("region", "US (Virginia)"),
  condition("deployment_scope", "Global"),
  condition("operation", "non_thinking_mode"),
];
function inputPrices(result: ReturnType<ReturnType<typeof lookup>>) {
  return result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === "input_text"
        ? term.variants.map(({ price }) => price.value)
        : [],
    ),
  );
}

it("keeps literal IDs and published regional prices independent of inferred ID prefixes", () => {
  const args = { provider_id: "dashscope", model_id: "qwen-plus" };
  const query = lookup();
  const initial = query(args);
  expect(initial.status).toBe("candidates");
  expect(initial.missing_conditions).toContainEqual({ namespace: "kmodels", value: "region" });
  for (const [size, numerator] of [
    ["128000", "23"],
    ["128001", "69"],
  ] as const) {
    const result = query({ ...args, selectors: [...globalUS, context(size)] });
    expect(result.status, JSON.stringify(result.missing_conditions)).toBe("matched");
    expect(inputPrices(result)).toEqual([{ numerator, denominator: "200000000" }]);
  }
  const regional = query({
    ...args,
    selectors: [
      condition("region", "US (Virginia)"),
      condition("deployment_scope", "US"),
      condition("operation", "non_thinking_mode"),
      context("128000"),
    ],
  });
  expect(regional.status, JSON.stringify(regional.missing_conditions)).toBe("matched");
  expect(inputPrices(regional)).toEqual([{ numerator: "1", denominator: "2500000" }]);
  for (const id of ["Qwen-plus", "us.qwen-plus", "qwen-plus-us", "my-deployment"]) {
    expect(query({ ...args, model_id: id }).reason).toBe("unreviewed_id");
  }
  expect(
    baseline.inference?.mapping.rules.every((rule) =>
      rule.fixed_selectors.every((selector) =>
        ["invocation_mode", "execution"].includes(selector.dimension.value),
      ),
    ),
  ).toBe(true);
});

it("preserves snapshot IDs and distinct on-demand and Batch offers", () => {
  const dated = lookup()({
    provider_id: "dashscope",
    model_id: "qwen-plus-2025-12-01",
    selectors: [...globalUS, context("128000")],
  });
  expect(dated.status).toBe("matched");
  expect(inputPrices(dated)).toEqual([{ numerator: "23", denominator: "200000000" }]);
  const result = lookup()({ provider_id: "dashscope", model_id: "qwen-flash" });
  expect(result.status).toBe("candidates");
  expect(new Set(result.candidates.map(({ offer }) => offer.name))).toEqual(
    new Set(["Public rates"]),
  );
});

it("distinguishes known price exclusions from unknown prices and IDs", () => {
  const excluded = lookup()({
    provider_id: "dashscope",
    model_id: "qwen-plus",
    selectors: [condition("region", "Singapore"), condition("deployment_scope", "US")],
  });
  expect(excluded.reason).toBe("no_applicable_price");
  expect(excluded.candidates).toEqual([]);
  const world = lookup()({ provider_id: "dashscope", model_id: "happyoyster-1.0-acting" });
  expect(world.reason).toBeUndefined();
  expect(world.candidates.length).toBeGreaterThan(0);
  expect(world.candidates.flatMap((c) => c.offer.terms).some((t) => t.kind === "rate")).toBe(true);
});

it("publishes literal Beijing IDs and CNY rates from the mainland price book", async () => {
  const candidate = await collect((bundles) => {
    const bundle = bundles.get("dashscope-pricing");
    if (!bundle) throw new Error("Missing fixture");
    bundle.documents.push({
      url: "https://help.aliyun.com/en/model-studio/model-pricing",
      body: `<section><h4>China (Beijing)</h4><table><thead><tr>
        <th>Model ID</th><th>Input price (per 1 million tokens)</th>
        <th>Output price (per 1 million tokens)</th>
        </tr></thead><tbody><tr>
        <td><p>qwen-long</p><blockquote><p>50% batch inference discount</p></blockquote></td>
        <td>CNY 0.5</td><td>CNY 2</td>
        </tr><tr>
        <td><p>qwen-doc-turbo</p></td><td>CNY 1</td><td>CNY 3</td>
        </tr><tr>
        <td><p>unreviewed-model</p><p>Special contract only</p></td><td>CNY 1</td><td>CNY 3</td>
        </tr></tbody></table>
        <table><thead><tr><th>Model ID</th><th>Mode</th><th>Input tokens per request</th>
        <th>Input price (per 1 million tokens)</th><th>Output price (per 1 million tokens)</th>
        </tr></thead><tbody><tr>
        <td>qwen-beijing-tiered</td><td>Thinking mode only</td><td>0&lt;Token≤32K</td><td>CNY 1</td><td>CNY 3</td>
        </tr><tr>
        <td>qwen-beijing-tiered</td><td>Thinking mode only</td><td>32K&lt;Token≤128K</td><td>CNY 2</td><td>CNY 6</td>
        </tr></tbody></table></section>`,
    });
  });
  const args = { provider_id: "dashscope", model_id: "qwen-long" };
  expect(lookup()(args).reason).toBe("unreviewed_id");
  const query = lookup(candidate);
  const result = query({
    ...args,
    selectors: [condition("region", "China (Beijing)")],
  });
  expect(new Set(result.candidates.map(({ offer }) => offer.name))).toEqual(
    new Set(["Public rates"]),
  );
  expect(inputPrices(result)).toEqual(
    expect.arrayContaining([
      { numerator: "1", denominator: "2000000" },
      { numerator: "1", denominator: "4000000" },
    ]),
  );
  expect(JSON.stringify(result.candidates)).toContain('"currency":"CNY"');
  expect(
    query({
      ...args,
      model_id: "qwen-doc-turbo",
      selectors: [condition("region", "China (Beijing)")],
    }).status,
  ).toBe("matched");
  expect(query({ ...args, model_id: "unreviewed-model" }).reason).toBe("unreviewed_id");
  const tiered = (tokens: string) =>
    query({
      ...args,
      model_id: "qwen-beijing-tiered",
      selectors: [
        condition("region", "China (Beijing)"),
        condition("operation", "thinking_mode_only"),
        context(tokens),
      ],
    });
  expect(inputPrices(tiered("32000"))).toEqual([{ numerator: "1", denominator: "1000000" }]);
  expect(inputPrices(tiered("32001"))).toEqual([{ numerator: "1", denominator: "500000" }]);
  expect(query({ ...args, selectors: [condition("region", "Singapore")] }).reason).toBe(
    "no_applicable_price",
  );
}, 20_000);

it("reads mainland annotation headers, cache annotations and flat-rate token cells", async () => {
  const candidate = await collect((bundles) => {
    const bundle = bundles.get("dashscope-pricing");
    if (!bundle) throw new Error("Missing fixture");
    bundle.documents.push({
      url: "https://help.aliyun.com/en/model-studio/model-pricing",
      body: `<section><h4>China (Beijing)</h4><table><thead><tr>
        <th>Model ID</th><th>Mode</th><th>Input price (per 1 million tokens)</th>
        <th>Output price (per 1 million tokens) Chain of thought and answer</th>
        </tr></thead><tbody><tr>
        <td><p>qwen-beijing-cache</p><blockquote><a>Context Cache</a> context caching discount</blockquote></td>
        <td>Thinking mode only</td><td>CNY 8</td><td>CNY 28</td>
        </tr><tr>
        <td><p>qwen-beijing-session-cache</p><blockquote>Session Cache discount</blockquote></td>
        <td>Thinking mode only</td><td>CNY 8</td><td>CNY 28</td>
        </tr></tbody></table>
        <table><thead><tr><th>Model ID</th><th>Mode</th><th>Input tokens per request</th>
        <th>Input price (per 1 million tokens)</th>
        <th>Output price (per 1 million tokens)Chain of thought and answer</th>
        </tr></thead><tbody><tr>
        <td>qwen-beijing-flat-rate</td><td>Non-Thinking and Thinking modes</td>
        <td>flat-rate pricing</td><td>CNY 20</td><td>CNY 100</td>
        </tr></tbody></table></section>`,
    });
  });
  const query = lookup(candidate);
  const args = { provider_id: "dashscope", model_id: "qwen-beijing-cache" };
  const cached = query({
    ...args,
    selectors: [
      condition("region", "China (Beijing)"),
      condition("operation", "thinking_mode_only"),
    ],
  });
  expect(cached.status).toBe("matched");
  expect(inputPrices(cached)).toEqual([{ numerator: "1", denominator: "125000" }]);
  expect(JSON.stringify(cached.candidates)).toContain('"currency":"CNY"');
  const flat = query({
    ...args,
    model_id: "qwen-beijing-flat-rate",
    selectors: [condition("region", "China (Beijing)")],
  });
  expect(flat.candidates.length).toBeGreaterThan(0);
  expect(inputPrices(flat)).toEqual(
    expect.arrayContaining([{ numerator: "1", denominator: "50000" }]),
  );
  expect(
    query({
      ...args,
      model_id: "qwen-beijing-session-cache",
      selectors: [condition("region", "China (Beijing)")],
    }).reason,
  ).toBe("unreviewed_id");
}, 20_000);

it("does not require protocol or accounting documents for literal price-table mappings", async () => {
  const bundles = await dashscopeInferenceFixture();
  const bundle = bundles.get("dashscope-pricing");
  if (!bundle || !manifest || !source) throw new Error("Missing fixture");
  const parse = (body: LinkedBundle) =>
    parseSource({
      provider: { ...manifest.provider, source_ids: [source.id] },
      source,
      body: JSON.stringify(body),
      observedAt: at,
    });
  const withCommercialGuides = parse(bundle);
  const withoutGuides = parse({ ...bundle, documents: [] });
  expect(withoutGuides.inference_prices).toEqual(withCommercialGuides.inference_prices);
  expect(
    withoutGuides.models
      .find((m) => m.model_id === "qwen-plus")
      ?.price_facts.some((f) => f.meter === "input_text"),
  ).toBe(true);
});

it("withdraws removed price-table IDs even when a cache guide still lists them", async () => {
  const current = await collect((bundles) => {
    const bundle = bundles.get("dashscope-pricing");
    if (!bundle) throw new Error("Missing fixture");
    bundle.index.body = bundle.index.body.replace(
      /(?<![-\w])qwen-plus(?![-\w])/g,
      "qwen-plus-replacement",
    );
  }, baseline);
  expect(lookup(current)({ provider_id: "dashscope", model_id: "qwen-plus" }).reason).toBe(
    "unreviewed_id",
  );
  expect(
    lookup(current)({
      provider_id: "dashscope",
      model_id: "qwen-plus-replacement",
      selectors: [...globalUS, context("128000")],
    }).status,
  ).toBe("matched");
  expect(
    lookup(current)({
      provider_id: "dashscope",
      model_id: "qwen-plus-2025-12-01",
      selectors: [...globalUS, context("128000")],
    }).status,
  ).toBe("matched");
}, 15000);

it("uses the same conditions and reasons in static output and compact UI data", async () => {
  const projection = await projectCatalogPair(baseline);
  expect(
    projection.exports.manifest.assets.some(
      ({ file_name }) => file_name === "pricing/inference.json",
    ),
  ).toBe(true);
  const details = projection.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projection.ui.pack, asset)).toString("utf8")))
        .details.map(restoreWebsiteInferenceDetail),
    );
  const detail = details.find(({ model_ref }) => model_ref === "dashscope/qwen-plus");
  const price = detail?.inference_prices?.find(({ model_id }) => model_id === "qwen-plus");
  if (!price) throw new Error("Missing inference ID in UI");
  for (const selectors of [
    [],
    [...globalUS, context("128000")],
    [condition("region", "Singapore"), condition("deployment_scope", "US")],
  ]) {
    const result = queryWebsiteInferencePrice(price, selectors, at);
    const expected = lookup()({ provider_id: "dashscope", model_id: price.model_id, selectors });
    expect(result.status).toBe(expected.status);
    expect(result.reason).toBe(expected.reason);
  }
  expect(JSON.stringify(detail)).not.toContain("content_hash");
  expect(JSON.stringify(detail)).not.toContain("observations");
}, 15000);

it("publishes exact console cache tariffs through collection, portable lookup and website details", async () => {
  const implicit = cacheMode("implicit");
  const market: unknown = JSON.parse(
    await readFile(new URL("./fixtures/dashscope/market-prices.json", import.meta.url), "utf8"),
  );
  const candidate = await collect((bundles) => {
    const bundle = bundles.get("dashscope-pricing");
    if (!bundle) throw new Error("Missing fixture");
    const updated = { ...bundle, market };
    bundles.set("dashscope-pricing", updated);
  });
  const query = lookup(candidate);
  for (const [region, scope, numerator, denominator] of [
    ["Germany (Frankfurt)", "Global", "69", "500000000"],
    ["Singapore", "International", "1", "5000000"],
    ["Japan (Tokyo)", "Japan", "1", "5000000"],
  ]) {
    if (!region || !scope) throw new Error("Missing scope");
    const selectors = [condition("region", region), condition("deployment_scope", scope), implicit];
    const result = query({ provider_id: "dashscope", model_id: "deepseek-v4-pro", selectors });
    expect(result.status, JSON.stringify(result.missing_conditions)).toBe("matched");
    expect(
      result.candidates
        .flatMap(({ offer }) => offer.terms)
        .filter((term) => term.kind === "rate" && term.meter.value === "cache_read_text")
        .flatMap((term) =>
          term.kind === "rate" ? term.variants.map(({ price }) => price.value) : [],
        ),
    ).toContainEqual({ numerator, denominator });
    expect(JSON.stringify(result.candidates)).not.toContain("unpublished_cache_read");
  }
  expect(
    query({
      provider_id: "dashscope",
      model_id: "deepseek-v4-pro",
      selectors: [
        condition("region", "Germany (Frankfurt)"),
        condition("deployment_scope", "Japan"),
      ],
    }).reason,
  ).toBe("no_applicable_price");
  const projection = await projectCatalogPair(candidate);
  const detail = projection.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projection.ui.pack, asset)).toString("utf8")))
        .details.map(restoreWebsiteInferenceDetail),
    )
    .find(({ model_ref }) => model_ref === "dashscope/deepseek-v4-pro");
  const price = detail?.inference_prices?.find(({ model_id }) => model_id === "deepseek-v4-pro");
  if (!price) throw new Error("Missing console price in website");
  const selectors = [
    condition("region", "Germany (Frankfurt)"),
    condition("deployment_scope", "Global"),
    implicit,
  ];
  expect(queryWebsiteInferencePrice(price, selectors, at).status).toBe("matched");
  expect(JSON.stringify(queryWebsiteInferencePrice(price, selectors, at))).not.toContain(
    "unpublished_cache_read",
  );
}, 20000);

it("publishes single-band models and TTL-specific cache tariffs through the real consumers", async () => {
  const market: unknown = JSON.parse(
    await readFile(new URL("./fixtures/dashscope/qwen4-market.json", import.meta.url), "utf8"),
  );
  const cache = await readFile(
    new URL("./fixtures/dashscope/qwen4-cache.md", import.meta.url),
    "utf8",
  );
  const change = (bundles: Map<string, LinkedBundle>, withAccounting: boolean) => {
    const bundle = bundles.get("dashscope-pricing");
    if (!bundle) throw new Error("Missing fixture");
    bundle.index.body += `<section><h4>Singapore</h4><table><thead><tr>
      <th>Model ID</th><th>Deployment scope</th><th>Mode</th><th>Input tokens per request</th>
      <th>Input price (per 1 million tokens)</th><th>Output price (per 1 million tokens)</th>
      </tr></thead><tbody><tr><td>qwen4-max</td><td>International</td><td>Non-Thinking and Thinking modes</td>
      <td>0&lt;Token≤1M</td><td>$1.5</td><td>$4.5</td></tr></tbody></table></section>`;
    if (withAccounting)
      bundle.documents.push({
        url: "https://www.alibabacloud.com/help/en/model-studio/explicit-cache-qwen4.md",
        body: cache,
      });
    const updated = { ...bundle, market };
    bundles.set("dashscope-pricing", updated);
  };
  const candidate = await collect((bundles) => change(bundles, true));
  const query = lookup(candidate);
  const base = [
    condition("region", "Singapore"),
    condition("deployment_scope", "International"),
    condition("operation", "non_thinking_and_thinking_modes"),
    context("1000000"),
  ];
  const ttl = (value: string): Selector => ({
    kind: "decimal",
    dimension: { namespace: "kmodels", value: "cache_ttl_seconds" },
    value,
    unit: { factors: [{ unit: { namespace: "kmodels", value: "second" }, power: 1 }] },
  });
  for (const [seconds, value, field] of [
    ["300", { numerator: "3", denominator: "1600000" }, "ephemeral_5m_input_tokens"],
    ["3600", { numerator: "3", denominator: "1000000" }, "ephemeral_1h_input_tokens"],
  ] as const) {
    const result = query({
      provider_id: "dashscope",
      model_id: "qwen4-max",
      selectors: [...base, cacheMode("explicit"), ttl(seconds)],
    });
    expect(result.status, JSON.stringify(result.missing_conditions)).toBe("matched");
    const terms = result.candidates.flatMap(({ offer }) => offer.terms);
    const writes = terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === "cache_write_text" ? term.variants : [],
    );
    expect(writes.map(({ price }) => price.value)).toEqual([value]);
    const pointers = writes.flatMap(
      ({ charge_binding }) =>
        charge_binding?.quantity_methods?.flatMap(
          ({ input_sources }) => input_sources?.map(({ locator }) => locator.value) ?? [],
        ) ?? [],
    );
    expect(pointers).toContain(`/usage/prompt_tokens_details/cache_creation/${field}`);
    expect(pointers).not.toContain("/usage/cache_creation_input_tokens");
    expect(pointers).not.toContain("/usage/prompt_tokens_details/cache_creation_input_tokens");
    expect(
      terms.some((term) => term.kind === "rate" && term.meter.value === "cache_read_text"),
    ).toBe(true);
  }
  expect(
    query({
      provider_id: "dashscope",
      model_id: "qwen4-max",
      selectors: [...base, cacheMode("implicit")],
    }).status,
  ).toBe("matched");

  const withoutAccounting = await collect((bundles) => change(bundles, false));
  const retainedPrice = lookup(withoutAccounting)({
    provider_id: "dashscope",
    model_id: "qwen4-max",
    selectors: [...base, cacheMode("explicit"), ttl("3600")],
  });
  const unboundWrites = retainedPrice.candidates
    .flatMap(({ offer }) => offer.terms)
    .flatMap((term) =>
      term.kind === "rate" && term.meter.value === "cache_write_text" ? term.variants : [],
    );
  expect(unboundWrites).toHaveLength(1);
  expect(unboundWrites[0]?.charge_binding?.quantity_methods).toBeUndefined();

  const projection = await projectCatalogPair(candidate);
  const detail = projection.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projection.ui.pack, asset)).toString("utf8")))
        .details.map(restoreWebsiteInferenceDetail),
    )
    .find(({ model_ref }) => model_ref === "dashscope/qwen4-max");
  const price = detail?.inference_prices?.find(({ model_id }) => model_id === "qwen4-max");
  if (!detail?.pricing || !price?.pricing_options) throw new Error("Missing Qwen4 website detail");
  const contextOption = price.pricing_options.find(
    ({ dimension }) => dimension.value === "context_tokens",
  );
  expect(contextOption).toMatchObject({ kind: "decimal_buckets", values: [{ label: "≤ 1M" }] });
  const fixed = fixedPricingSelections(price.pricing_options);
  expect(
    queryWebsiteInferencePrice(price, [...base.slice(0, 2), ...fixed, cacheMode("implicit")], at)
      .status,
  ).toBe("matched");
  const model = candidate.catalog.models.find(({ uid }) => uid === detail.model_ref);
  if (!model) throw new Error("Missing Qwen4 model");
  const html = await renderComponent(InferencePrices, {
    modelRef: detail.model_ref,
    prices: detail.inference_prices,
    offers: websiteModelDetail(candidate.pricing.data, model).pricing?.offers ?? [],
  });
  expect(html).not.toContain("≤ 1M");
  expect(html).not.toContain("Price scope");
  expect(html).not.toContain('placeholder="Enter value"');
  expect(html).not.toContain("Some prices are unresolved");
}, 20000);

it("replaces an accepted Beijing cache gap with its exact regional quote without inventing deployment scope", async () => {
  const market: unknown = JSON.parse(
    await readFile(new URL("./fixtures/dashscope/qwen4-market.json", import.meta.url), "utf8"),
  );
  const change = (bundles: Map<string, LinkedBundle>, withMarket: boolean) => {
    const bundle = bundles.get("dashscope-pricing");
    const cache = bundle?.documents.find(({ url }) => url.endsWith("/context-cache.md"));
    if (!bundle || !cache) throw new Error("Missing fixture");
    bundle.index.body += `<section><h4>China (Beijing)</h4><table><thead><tr>
      <th>Model ID</th><th>Mode</th><th>Input tokens per request</th>
      <th>Input price (per 1 million tokens)</th><th>Output price (per 1 million tokens)</th>
      </tr></thead><tbody><tr><td>qwen4-max</td><td>Non-Thinking and Thinking modes</td>
      <td>0&lt;Token≤1M</td><td>$1.413</td><td>$4.24</td></tr></tbody></table></section>`;
    cache.body = `# Context cache
Cache creation is billed at 125% of the standard input token price; reads at 10% of the standard input token price. Implicit reads cost 20% of the standard input token price.
For qwen4-max, the unit price of cached_token is not 20% of the input_token unit price.
## Explicit cache
### Supported models
#### China (Beijing)
- qwen3.7-plus
## Implicit cache
### Supported models
#### China (Beijing)
- qwen4-max`;
    if (withMarket) {
      const updated = { ...bundle, market };
      bundles.set("dashscope-pricing", updated);
    }
  };
  const implicit = cacheMode("implicit");
  const selectors = [
    condition("region", "China (Beijing)"),
    condition("operation", "non_thinking_and_thinking_modes"),
    context("1000000"),
    implicit,
  ];
  const query = { provider_id: "dashscope", model_id: "qwen4-max", selectors };
  const missing = await collect((bundles) => change(bundles, false));
  const unresolved = lookup(missing)(query);
  expect(unresolved.status).toBe("candidates");
  expect(JSON.stringify(unresolved.candidates)).toContain("unpublished_cache_read");
  expect(
    unresolved.candidates.flatMap(({ offer }) => offer.terms).some((term) => term.kind === "rate"),
  ).toBe(true);

  const candidate = await collect((bundles) => change(bundles, true), missing);
  const result = lookup(candidate)(query);
  expect(result.status).toBe("matched");
  expect(JSON.stringify(result.candidates)).not.toContain("unpublished_cache_read");
  const rates = result.candidates.flatMap(({ offer }) => offer.terms);
  expect(
    rates
      .flatMap((term) =>
        term.kind === "rate" && term.meter.value === "cache_read_text" ? term.variants : [],
      )
      .map(({ price }) => price.value),
  ).toEqual([{ numerator: "71", denominator: "1000000000" }]);
  expect(candidate.pricing.data.provider_snapshots[0]?.publication).toBe("fresh");
  const modelRef = "dashscope/qwen4-max";
  if (!candidate.inference) throw new Error("Missing Beijing ID mapping");
  const price = websiteInferencePrices(
    candidate.catalog,
    candidate.pricing,
    candidate.inference.mapping,
  ).get(modelRef)?.[0];
  if (!price) throw new Error("Missing Beijing UI price");
  expect(queryWebsiteInferencePrice(price, selectors, at).status).toBe(result.status);
}, 20000);
