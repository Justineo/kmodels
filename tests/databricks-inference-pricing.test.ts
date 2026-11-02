import { gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { databricksInferenceFixture } from "./databricks-inference-fixture.ts";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { parseSource } from "../src/catalog/adapters.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests } from "../src/catalog/manifests.ts";
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
import type { SourceContractEvidence } from "../src/catalog/source-contract.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T19:45:00.000Z";
const manifest = manifests.find(({ provider }) => provider.id === "databricks");
const source = manifest?.sources.find(({ id }) => id === "databricks-models");
if (!manifest || !source) throw new Error("Missing Databricks source");
async function collect(change?: (bundle: LinkedBundle) => void, previous?: CatalogPairCandidate) {
  const bundle = await databricksInferenceFixture();
  change?.(bundle);
  const body = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
  if (!manifest || !source) throw new Error("Missing Databricks source");
  const result = await collectProvider(
    { ...manifest, sources: [source] },
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
  dimension: "served_service_tier" | "deployment_scope" | "cache_retention",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension:
      dimension === "cache_retention"
        ? { namespace: "provider", provider_id: "databricks", value: dimension }
        : { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "databricks", value },
  };
}
const standard = condition("served_service_tier", "standard");
function prices(result: ReturnType<ReturnType<typeof lookup>>, meter: string) {
  return result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === meter
        ? term.variants.map(({ price }) => price)
        : [],
    ),
  );
}
it("publishes exact endpoint IDs and preserves DBU prices, including the input-only partner table", () => {
  expect(baseline.inference?.mapping.rules).toHaveLength(69);
  for (const [model_id, numerator, denominator] of [
    ["databricks-gpt-oss-20b", "1", "1000000"],
    ["databricks-typesafeai-jev-1-14-0", "3", "5000000"],
  ]) {
    if (!model_id) throw new Error("Missing test ID");
    const result = lookup()({ provider_id: "databricks", model_id, selectors: [standard] });
    expect(result.status).toBe("matched");
    expect(prices(result, "input_text")).toEqual([
      expect.objectContaining({ value: { numerator, denominator } }),
    ]);
    expect(JSON.stringify(prices(result, "input_text"))).toContain("DBU");
    expect(JSON.stringify(prices(result, "input_text"))).not.toContain("USD");
  }
  const jev = lookup()({
    provider_id: "databricks",
    model_id: "databricks-typesafeai-jev-1-14-0",
    selectors: [standard],
  });
  expect(prices(jev, "output_text")).toEqual([]);
});
it("keeps geography and served tier as price conditions rather than deriving them from the ID", () => {
  const args = { provider_id: "databricks", model_id: "databricks-claude-sonnet-5-5" };
  const result = lookup()(args);
  expect(result.status).toBe("candidates");
  expect(result.missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "deployment_scope",
  });
  for (const [value, numerator, denominator] of [
    ["non_regional_processing", "28571", "1000000000"],
    ["regional_processing", "314281", "10000000000"],
  ]) {
    if (!value) throw new Error("Missing scope");
    const match = lookup()({
      ...args,
      selectors: [
        standard,
        condition("deployment_scope", value),
        condition("cache_retention", "default"),
      ],
    });
    expect(match.status).toBe("matched");
    expect(prices(match, "input_text")).toEqual([
      expect.objectContaining({ value: { numerator, denominator } }),
    ]);
  }
  expect(
    lookup()({
      provider_id: "databricks",
      model_id: "databricks-gpt-oss-20b",
      selectors: [condition("served_service_tier", "priority")],
    }),
  ).toMatchObject({ status: "unknown", reason: "no_applicable_price" });
});
it("does not invent regional prefixes, upstream names, or private deployment aliases", () => {
  for (const model_id of [
    "gpt-oss-20b",
    "us.databricks-gpt-oss-20b",
    "DATABRICKS-GPT-OSS-20B",
    "private-endpoint",
    "databricks-typesafeai-jev-latest",
  ])
    expect(lookup()({ provider_id: "databricks", model_id })).toMatchObject({
      status: "unknown",
      reason: "unreviewed_id",
    });
});
it("distinguishes known unresolved tariffs from unmapped identifiers", () => {
  const result = lookup()({
    provider_id: "databricks",
    model_id: "databricks-gemini-3-1-flash-image",
    selectors: [standard],
  });
  expect(result).toMatchObject({ status: "unknown", reason: "unresolved_price" });
  expect(result.evidence.length).toBeGreaterThan(0);
  expect(
    baseline.inference?.mapping.rules.some(({ model_id }) => model_id === result.query.model_id),
  ).toBe(true);
});
it("keeps prices when optional API and task documents are absent or drift", async () => {
  const current = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(
      ({ url }) => !url.endsWith("/api-reference") && !url.endsWith("/score-foundation-models"),
    );
  });
  expect(current.inference?.mapping.rules.map(({ model_id }) => model_id)).toEqual(
    baseline.inference?.mapping.rules.map(({ model_id }) => model_id),
  );
  expect(
    lookup(current)({
      provider_id: "databricks",
      model_id: "databricks-typesafeai-jev-1-14-0",
      selectors: [standard],
    }).status,
  ).toBe("matched");
  const bundle = await databricksInferenceFixture();
  const ref = bundle.documents.find(({ url }) => url.endsWith("/api-reference"));
  if (!ref) throw new Error("Missing API evidence");
  ref.body = "<main>Changed API schema</main>";
  const findings: SourceContractEvidence[] = [];
  const parsed = parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    observedAt: at,
    body: JSON.stringify(bundle),
    onContractFinding: (x) => findings.push(x),
  });
  expect(parsed.inference_prices).toHaveLength(69);
  expect(parsed.pricing_inputs).toEqual([]);
  expect(findings).toContainEqual(
    expect.objectContaining({
      diagnostics: [expect.objectContaining({ path: "/documents/api-support" })],
    }),
  );
}, 15000);
it("withdraws a price association when its exact price row disappears", async () => {
  const current = await collect((bundle) => {
    const doc = bundle.documents.find(({ url }) => url.endsWith("/foundation-model-serving"));
    if (!doc) throw new Error("Missing open prices");
    const $ = load(doc.body);
    $("tbody tr")
      .filter((_i, row) => /GPT-OSS-20B/.test($(row).text()))
      .remove();
    doc.body = $.html();
  }, baseline);
  expect(current.catalog.models.some(({ model_id }) => model_id === "databricks-gpt-oss-20b")).toBe(
    true,
  );
  expect(
    lookup(current)({ provider_id: "databricks", model_id: "databricks-gpt-oss-20b" }),
  ).toMatchObject({ status: "unknown", reason: "unreviewed_id" });
  expect(
    lookup(current)({
      provider_id: "databricks",
      model_id: "databricks-typesafeai-jev-1-14-0",
      selectors: [standard],
    }).status,
  ).toBe("matched");
}, 15000);
it("projects the same direct lookup into static exports and compact UI data", async () => {
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
  const detail = details.find(({ model_ref }) => model_ref === "databricks/databricks-gpt-oss-20b");
  const price = detail?.inference_prices?.[0];
  if (!price) throw new Error("Missing ID projection");
  const publicResult = lookup()({
    provider_id: "databricks",
    model_id: price.model_id,
    selectors: [standard],
  });
  const ui = queryWebsiteInferencePrice(price, [standard], at);
  expect(ui.status).toBe(publicResult.status);
  expect(JSON.stringify(detail)).not.toContain("content_hash");
  expect(JSON.stringify(detail)).not.toContain("observations");
  const claude = details.find(
    ({ model_ref }) => model_ref === "databricks/databricks-claude-sonnet-5-5",
  )?.inference_prices?.[0];
  if (!claude) throw new Error("Missing Claude projection");
  expect(queryWebsiteInferencePrice(claude, [], at).missing_conditions).toContain(
    "Cache retention",
  );
  expect(claude.missing_conditions).toContain("Cache retention");
}, 15000);
