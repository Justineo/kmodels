import { gunzipSync } from "node:zlib";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { huggingFaceInferenceFixture } from "./huggingface-inference-fixture.ts";
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
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T20:20:00.000Z";
const manifest = manifests.find(({ provider }) => provider.id === "huggingface");
const source = manifest?.sources.find(({ id }) => id === "huggingface-router");
if (!manifest || !source) throw new Error("Missing Hugging Face source");
async function collect(change?: (bundle: LinkedBundle) => void, previous?: CatalogPairCandidate) {
  const bundle = await huggingFaceInferenceFixture();
  change?.(bundle);
  const body = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
  if (!manifest || !source) throw new Error("Missing Hugging Face source");
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

function route(value: string): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "route_provider" },
    value: { namespace: "provider", provider_id: "huggingface", value },
  };
}
const model = "openai/gpt-oss-120b";
const args = { provider_id: "huggingface", model_id: model };
function inputPrices(result: ReturnType<ReturnType<typeof lookup>>) {
  return result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === "input_text"
        ? term.variants.map(({ price }) => price.value)
        : [],
    ),
  );
}

it("joins exact router IDs to per-provider prices and binds only documented pinned suffixes", () => {
  expect(baseline.catalog.models).toHaveLength(137);
  const unpinned = lookup()(args);
  expect(unpinned.status).toBe("candidates");
  expect(unpinned.missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "route_provider",
  });
  const pinned = lookup()({ ...args, model_id: `${model}:groq` });
  expect(pinned.status).toBe("matched");
  expect(pinned.missing_conditions).toEqual([]);
  expect(inputPrices(pinned)).toEqual([{ numerator: "3", denominator: "20000000" }]);
  expect(inputPrices(lookup()({ ...args, selectors: [route("groq")] }))).toEqual(
    inputPrices(pinned),
  );
  expect(inputPrices(lookup()({ ...args, model_id: `${model}:novita` }))).toEqual([
    { numerator: "1", denominator: "20000000" },
  ]);
});

it("keeps routing policies unresolved until the actual route is supplied", () => {
  for (const suffix of ["fastest", "cheapest", "preferred"]) {
    const query = { ...args, model_id: `${model}:${suffix}` };
    const result = lookup()(query);
    expect(result.status).toBe("candidates");
    expect(result.missing_conditions).toContainEqual({
      namespace: "kmodels",
      value: "route_provider",
    });
    expect(inputPrices(result)).toEqual(inputPrices(lookup()(args)));
    expect(inputPrices(lookup()({ ...query, selectors: [route("groq")] }))).toEqual([
      { numerator: "3", denominator: "20000000" },
    ]);
  }
});

it("distinguishes unknown IDs, unresolved prices and excluded known route conditions", () => {
  for (const model_id of [
    "gpt-oss-120b",
    `${model}:auto`,
    `${model}:us`,
    `${model}:replicate`,
    `${model}:GROQ`,
    "OPENAI/gpt-oss-120b",
    "private-endpoint",
  ])
    expect(lookup()({ ...args, model_id })).toMatchObject({
      status: "unknown",
      reason: "unreviewed_id",
    });
  expect(lookup()({ ...args, model_id: `${model}:featherless-ai` })).toMatchObject({
    status: "unknown",
    reason: "unresolved_price",
  });
  expect(
    lookup()({ ...args, model_id: `${model}:groq`, selectors: [route("novita")] }),
  ).toMatchObject({
    status: "unknown",
    reason: "incompatible_conditions",
  });
  expect(lookup()({ ...args, selectors: [route("cohere")] })).toMatchObject({
    status: "unknown",
    reason: "no_applicable_price",
  });
});

it("withdraws suffixes when their evidence changes without suppressing literal IDs or prices", async () => {
  const current = await collect((bundle) => {
    bundle.documents = [];
  }, baseline);
  expect(lookup(current)({ ...args, selectors: [route("groq")] }).status).toBe("matched");
  for (const suffix of ["groq", "fastest", "cheapest", "preferred"])
    expect(lookup(current)({ ...args, model_id: `${model}:${suffix}` }).reason).toBe(
      "unreviewed_id",
    );
  const bundle = await huggingFaceInferenceFixture();
  const overview = bundle.documents.find(({ url }) => url.endsWith("/index.md"));
  if (!overview) throw new Error("Missing overview");
  overview.body = overview.body.replaceAll(
    "select the provider of your choice by appending the provider name to the model id",
    "changed selection contract",
  );
  const findings: string[] = [];
  const parsed = parseSource({
    provider: { ...manifest.provider, source_ids: [source.id] },
    source,
    observedAt: at,
    body: JSON.stringify(bundle),
    onPricingReconciliation: (finding) => findings.push(finding.reason_code),
  });
  expect(findings).toContain("model_id_suffix_contract_drift");
  expect(parsed.inference_prices?.some(({ model_id }) => model_id === `${model}:groq`)).toBe(false);
  expect(parsed.inference_prices?.some(({ model_id }) => model_id === `${model}:cheapest`)).toBe(
    true,
  );
});

it("does not require usage, capability or protocol companions for direct prices", async () => {
  const current = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(({ url }) => url.endsWith("/index.md"));
  });
  expect(current.inference?.mapping.rules).toEqual(baseline.inference?.mapping.rules);
  expect(lookup(current)({ ...args, model_id: `${model}:groq` }).status).toBe("matched");
});

it("withdraws an unavailable provider suffix while keeping sibling routes", async () => {
  const current = await collect((bundle) => {
    bundle.index.body = bundle.index.body.replaceAll(
      '"provider":"groq","status":"live"',
      '"provider":"groq","status":"error"',
    );
  }, baseline);
  expect(lookup(current)({ ...args, model_id: `${model}:groq` }).reason).toBe("unreviewed_id");
  expect(lookup(current)({ ...args, model_id: `${model}:novita` }).status).toBe("matched");
});

it("exports literal and suffixed IDs with the same matching semantics in compact UI data", async () => {
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
    )
    .map(restoreWebsiteInferenceDetail);
  const detail = details.find(({ model_ref }) => model_ref === `huggingface/${model}`);
  for (const suffix of ["", ":groq", ":cheapest", ":featherless-ai"]) {
    const price = detail?.inference_prices?.find(({ model_id }) => model_id === model + suffix);
    if (!price) throw new Error(`Missing inference ID ${suffix}`);
    const result = queryWebsiteInferencePrice(price, [], at);
    const expected = lookup()({ ...args, model_id: model + suffix });
    expect(result.status).toBe(expected.status);
    expect(result.reason).toBe(expected.reason);
  }
  expect(JSON.stringify(detail)).not.toContain("content_hash");
  expect(JSON.stringify(detail)).not.toContain("observations");
}, 15000);
