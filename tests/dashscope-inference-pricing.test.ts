import { gunzipSync } from "node:zlib";
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
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Selector } from "../src/pricing/schema.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";

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
    calculationExport(candidate.catalog, candidate.pricing),
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
  const initial = lookup()(args);
  expect(initial.status).toBe("candidates");
  expect(initial.missing_conditions).toContainEqual({ namespace: "kmodels", value: "region" });
  for (const [size, numerator] of [
    ["128000", "23"],
    ["128001", "69"],
  ] as const) {
    const result = lookup()({ ...args, selectors: [...globalUS, context(size)] });
    expect(result.status, JSON.stringify(result.missing_conditions)).toBe("matched");
    expect(inputPrices(result)).toEqual([{ numerator, denominator: "200000000" }]);
  }
  const regional = lookup()({
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
    expect(lookup()({ ...args, model_id: id }).reason).toBe("unreviewed_id");
  }
  expect(baseline.inference?.mapping.rules.every((rule) => rule.fixed_selectors.length === 0)).toBe(
    true,
  );
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
    new Set(["On-demand inference", "Batch inference"]),
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
