import { gunzipSync } from "node:zlib";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { vertexInferenceFixture } from "./vertex-inference-fixture.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { load } from "cheerio";
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

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T20:00:00.000Z";
const manifest: ProviderManifest | undefined = manifests.find(
  ({ provider }) => provider.id === "vertex",
);
const source = manifest?.sources.find(({ id }) => id === "vertex-pricing");
if (!manifest || !source) throw new Error("Missing Vertex source");
async function collect(
  change?: (bundles: Map<string, LinkedBundle>) => void,
  previous?: CatalogPairCandidate,
) {
  const bundles = await vertexInferenceFixture();
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
    throw new Error("Missing Vertex source");
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
  dimension: "served_service_tier" | "deployment_scope" | "region",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "vertex", value },
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
const standard = condition("served_service_tier", "standard");
function inputPrices(result: ReturnType<ReturnType<typeof lookup>>) {
  return result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === "input_text"
        ? term.variants.map(({ price }) => price.value)
        : [],
    ),
  );
}

it("joins literal managed model IDs and exact qualified request examples to existing tariffs", () => {
  const query = lookup();
  const direct = query({
    provider_id: "vertex",
    model_id: "mistral-medium-3",
    selectors: [standard],
  });
  expect(direct.status, JSON.stringify(direct.missing_conditions)).toBe("matched");
  expect(inputPrices(direct)).toEqual([{ numerator: "1", denominator: "2500000" }]);
  const qualified = query({
    provider_id: "vertex",
    model_id: "deepseek-ai/deepseek-v3.2-maas",
    selectors: [standard],
  });
  expect(qualified.status, JSON.stringify(qualified.missing_conditions)).toBe("matched");
  expect(inputPrices(qualified)).toEqual([{ numerator: "7", denominator: "12500000" }]);
  expect(
    query({
      provider_id: "vertex",
      model_id: "meta/llama-4-scout-17b-16e-instruct-maas",
      selectors: [standard],
    }).reason,
  ).toBe("unreviewed_id");
});

it("keeps context, served tier and published geography separate from request ID spelling", () => {
  const args = { provider_id: "vertex", model_id: "xai/grok-4.20-reasoning" };
  const result = lookup()(args);
  expect(result.status).toBe("candidates");
  expect(result.missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "context_tokens",
  });
  for (const [value, numerator, denominator] of [
    ["200000", "1", "800000"],
    ["200001", "1", "400000"],
  ]) {
    if (!value) throw new Error("Missing context");
    const result = lookup()({ ...args, selectors: [standard, context(value)] });
    expect(result.status, JSON.stringify(result.missing_conditions)).toBe("matched");
    expect(inputPrices(result)).toEqual([{ numerator, denominator }]);
  }
  const google = lookup()({ provider_id: "vertex", model_id: "gemini-3.5-flash" });
  expect(google.missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "deployment_scope",
  });
  for (const scope of ["global", "non-global"]) {
    const result = lookup()({
      provider_id: "vertex",
      model_id: "gemini-3.5-flash",
      selectors: [standard, condition("deployment_scope", scope), context("1000")],
    });
    const sync = result.candidates.find(({ offer }) => offer.offer_key === "sync");
    if (!sync) throw new Error("Missing online offer");
    const selected = lookup()({
      provider_id: "vertex",
      model_id: "gemini-3.5-flash",
      offer_ref: sync.offer.id,
      selectors: [standard, condition("deployment_scope", scope), context("1000")],
    });
    expect(selected.status).toBe("matched");
    expect(inputPrices(selected)).toEqual([
      scope === "global"
        ? { numerator: "3", denominator: "2000000" }
        : { numerator: "33", denominator: "20000000" },
    ]);
  }
});

it("distinguishes evidence gaps and excluded known conditions from guessed or private identifiers", () => {
  for (const model_id of [
    "us.gemini-3.5-flash",
    "google/gemini-3.5-flash",
    "GEMINI-3.5-FLASH",
    "projects/private/locations/us-central1/endpoints/123",
    "mistral-medium-latest",
  ])
    expect(lookup()({ provider_id: "vertex", model_id }).reason).toBe("unreviewed_id");
  expect(
    lookup()({
      provider_id: "vertex",
      model_id: "claude-sonnet-4-6",
      selectors: [standard, condition("region", "global")],
    }),
  ).toMatchObject({ status: "unknown", reason: "unresolved_price" });
  expect(
    lookup()({
      provider_id: "vertex",
      model_id: "mistral-medium-3",
      selectors: [condition("served_service_tier", "priority")],
    }).status,
  ).toBe("matched");
  const batch = lookup()({ provider_id: "vertex", model_id: "deepseek-v3.2-maas" }).candidates.find(
    ({ offer }) => offer.offer_key === "batch",
  );
  if (!batch) throw new Error("Missing Batch offer");
  expect(
    lookup()({
      provider_id: "vertex",
      model_id: "deepseek-ai/deepseek-v3.2-maas",
      offer_ref: batch.offer.id,
    }),
  ).toMatchObject({ status: "unknown", reason: "no_applicable_price" });
});

it("reads relocated partner prices and rejects missing or duplicated commercial companions", async () => {
  const bundles = await vertexInferenceFixture();
  const bundle = bundles.get("vertex-pricing");
  if (!bundle) throw new Error("Missing prices");
  const partner = bundle.documents.find(({ url }) => url.endsWith("/partner-models/pricing"));
  if (!partner) throw new Error("Missing partner prices");
  for (const documents of [
    bundle.documents.filter((doc) => doc !== partner),
    [...bundle.documents, partner],
  ])
    expect(() =>
      parseSource({
        provider: { ...manifest.provider, source_ids: [source.id] },
        source,
        observedAt: at,
        catalogModels: baseline.catalog.models,
        body: JSON.stringify({ ...bundle, documents }),
      }),
    ).toThrow("partner pricing companion is missing or duplicated");
  expect(
    inputPrices(
      lookup()({ provider_id: "vertex", model_id: "mistral-medium-3", selectors: [standard] }),
    ),
  ).not.toEqual([]);
});

it("keeps base associations when optional protocol guides disappear and withdraws their qualified forms", async () => {
  const current = await collect((bundles) => {
    for (const id of ["vertex-google-models", "vertex-partner-models", "vertex-open-models"]) {
      const bundle = bundles.get(id);
      const source = manifest.sources.find((source) => source.id === id);
      if (!bundle || !source) throw new Error(id);
      const optional = new Set(source.linkedDocuments?.documents?.map(({ url }) => url));
      bundle.documents = bundle.documents.filter(({ url }) => !optional.has(url));
    }
  }, baseline);
  expect(
    lookup(current)({ provider_id: "vertex", model_id: "mistral-medium-3", selectors: [standard] })
      .status,
  ).toBe("matched");
  expect(
    lookup(current)({ provider_id: "vertex", model_id: "xai/grok-4.20-reasoning" }).reason,
  ).toBe("unreviewed_id");
  expect(
    lookup(current)({
      provider_id: "vertex",
      model_id: "grok-4.20-reasoning",
      selectors: [standard, context("1000")],
    }).status,
  ).toBe("matched");
}, 15000);

it("withdraws a qualified spelling whose request evidence disappears while retaining the native ID", async () => {
  const current = await collect((bundles) => {
    const bundle = bundles.get("vertex-open-models");
    if (!bundle) throw new Error("Missing open model evidence");
    for (const document of bundle.documents) {
      const $ = load(document.body);
      $("pre")
        .filter((_i, e) => $(e).text().includes("deepseek-ai/deepseek-v3.2-maas"))
        .remove();
      document.body = $.html();
    }
  }, baseline);
  expect(
    lookup(current)({ provider_id: "vertex", model_id: "deepseek-ai/deepseek-v3.2-maas" }).reason,
  ).toBe("unreviewed_id");
  expect(
    lookup(current)({ provider_id: "vertex", model_id: "deepseek-v3.2-maas" }).candidates.length,
  ).toBeGreaterThan(0);
}, 15000);

it("publishes identical ID lookup semantics in the static and compact UI projections", async () => {
  const projection = await projectCatalogPair(baseline);
  expect(
    projection.exports.manifest.assets.some(
      ({ file_name }) => file_name === "pricing/inference.json",
    ),
  ).toBe(true);
  const details = projection.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap(
      (asset) =>
        websiteDetailChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projection.ui.pack, asset)).toString("utf8")),
        ).details,
    );
  const detail = details.find(({ model_ref }) => model_ref === "vertex/grok-4.20-reasoning");
  const price = detail?.inference_prices?.find(
    ({ model_id }) => model_id === "xai/grok-4.20-reasoning",
  );
  if (!price) throw new Error("Missing qualified ID in UI");
  for (const selectors of [[], [standard, context("1000")]]) {
    const result = queryWebsiteInferencePrice(price, selectors, at);
    const expected = lookup()({ provider_id: "vertex", model_id: price.model_id, selectors });
    expect(result.status).toBe(expected.status);
    expect(result.reason).toBe(expected.reason);
  }
  expect(JSON.stringify(detail)).not.toContain("content_hash");
  expect(JSON.stringify(detail)).not.toContain("observations");
}, 15000);
