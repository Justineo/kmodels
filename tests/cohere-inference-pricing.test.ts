import { gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { expect, it, vi } from "vite-plus/test";
import type { LinkedBundle } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
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
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Selector } from "../src/pricing/schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import { cohereInferenceBundle, cohereInferenceFixture } from "./cohere-inference-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T17:30:00.000Z";
const existingCustomer: Selector = {
  kind: "categorical",
  dimension: { namespace: "kmodels", value: "account_eligibility" },
  value: { namespace: "provider", provider_id: "cohere", value: "existing_customer" },
};
async function collect(change?: (bundle: LinkedBundle) => void, previous?: CatalogPairCandidate) {
  const manifest = manifests.find(({ provider }) => provider.id === "cohere");
  const catalog = manifest?.sources.find(({ id }) => id === "cohere-models");
  const pricing = manifest?.sources.find(({ id }) => id === "cohere-pricing");
  if (!manifest || !catalog || !pricing) throw new Error("Missing Cohere sources");
  const bundle = await cohereInferenceBundle();
  change?.(bundle);
  const bodies = new Map([
    [catalog.id, JSON.stringify(bundle)],
    [pricing.id, await cohereInferenceFixture("pricing.html")],
  ]);
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const body = bodies.get(source.id);
    if (!body) throw new Error("Missing fixture");
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  const result = await collectProvider(
    { ...manifest, sources: [catalog, pricing] },
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
  const composed = composeCatalogPair(
    previous?.catalog,
    core,
    previous?.pricing.data ?? emptyPricingCatalog(),
    [{ kind: "fresh", partition: result.pricing }],
  );
  return {
    candidate: compileInferencePriceMapping(
      prepareCatalogPair(composed.catalog, composed.pricing),
      result.inferencePriceSources ?? [],
      previous,
    ),
    facts: result.inferencePriceSources?.flatMap(({ rules }) => rules) ?? [],
  };
}
function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    priceDataExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

it("maps exact Cohere hosted IDs to their existing free and numeric prices without protocol sources", async () => {
  const { candidate, facts } = await collect();
  const query = lookup(candidate);
  for (const model_id of [
    "command-a-plus-05-2026",
    "cohere-transcribe-03-2026",
    "cohere-transcribe-arabic-07-2026",
    "c4ai-aya-expanse-32b",
  ])
    expect(query({ provider_id: "cohere", model_id }).status, model_id).toBe("matched");
  const aya = query({ provider_id: "cohere", model_id: "c4ai-aya-expanse-32b" });
  expect(
    aya.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "input_text"
          ? term.variants.map(({ price }) => price.value)
          : [],
      ),
    ),
  ).toEqual([{ numerator: "1", denominator: "2000000" }]);
  expect(facts.every(({ fixed_selectors }) => fixed_selectors.length === 0)).toBe(true);
  expect(facts.some(({ model_id }) => model_id === "command-nightly")).toBe(false);
  expect(
    candidate.inference?.mapping.rules.every(({ evidence }) =>
      evidence.every(({ source_ref }) => source_ref === "cohere-models"),
    ),
  ).toBe(true);
});

it("associates current Embed, Parse and token-denominated Rerank 5 meters", async () => {
  const { candidate, facts } = await collect();
  const query = lookup(candidate);
  for (const [model_id, meter] of [
    ["embed-v5.0-fast", "embedding"],
    ["embed-v5.0-pro", "embedding"],
    ["parse-v5.0", "input_image"],
  ] as const) {
    const result = query({ provider_id: "cohere", model_id });
    expect(result.candidates, model_id).toHaveLength(1);
    expect(
      result.candidates[0]?.offer.terms.some(
        (term) => term.kind === "rate" && term.meter.value === meter && term.variants.length > 0,
      ),
      model_id,
    ).toBe(true);
    expect(result.candidates[0]?.model_ref).toBe(`cohere/${model_id}`);
  }
  for (const [model_id, denominator] of [
    ["rerank-v5.0-fast", "50000000"],
    ["rerank-v5.0-pro", "20000000"],
  ] as const) {
    expect(facts.some((fact) => fact.model_id === model_id)).toBe(true);
    const result = query({ provider_id: "cohere", model_id });
    expect(result.status).toBe("matched");
    expect(result.candidates[0]?.offer.terms).toContainEqual(
      expect.objectContaining({
        meter: { namespace: "kmodels", value: "rerank" },
        variants: [
          expect.objectContaining({
            price: expect.objectContaining({ value: { numerator: "1", denominator } }),
            charge_binding: expect.objectContaining({
              signal: { namespace: "kmodels", value: "input_tokens" },
            }),
          }),
        ],
      }),
    );
  }
});

it("requires existing-customer eligibility for the exact dated legacy model", async () => {
  const { candidate } = await collect();
  const query = lookup(candidate);
  const args = { provider_id: "cohere", model_id: "command-r-plus-08-2024" };
  expect(query(args)).toMatchObject({
    status: "candidates",
    missing_conditions: [{ namespace: "kmodels", value: "account_eligibility" }],
  });
  const result = query({ ...args, selectors: [existingCustomer] });
  expect(result.status).toBe("matched");
  expect(
    result.candidates.flatMap(({ offer }) =>
      offer.terms.flatMap((term) =>
        term.kind === "rate" && term.meter.value === "input_text"
          ? term.variants.map(({ price }) => price.value)
          : [],
      ),
    ),
  ).toEqual([{ numerator: "1", denominator: "400000" }]);
  for (const model_id of [
    "cohere.command-r-plus-v1:0",
    "coherelabs-command-a-plus-05-2026-w4a4",
    "private-vault",
    "Command R+",
    "us.command-r-plus-08-2024",
    "command-nightly",
  ])
    expect(query({ provider_id: "cohere", model_id }).reason).toBe("unreviewed_id");
});

it("withdraws an ID association despite retained catalog identity and refreshed central pricing", async () => {
  const { candidate: previous } = await collect();
  const { candidate } = await collect((bundle) => {
    const overview = bundle.documents.find(
      ({ url }) => url === "https://docs.cohere.com/docs/models",
    );
    if (!overview) throw new Error("Missing overview");
    const $ = load(overview.body);
    $("tr")
      .filter((_index, row) => $(row).find("td").first().text() === "command-r-plus-08-2024")
      .remove();
    overview.body = $.html();
  }, previous);
  expect(
    candidate.catalog.models.some(({ model_id }) => model_id === "command-r-plus-08-2024"),
  ).toBe(true);
  expect(
    lookup(candidate)({
      provider_id: "cohere",
      model_id: "command-r-plus-08-2024",
      selectors: [existingCustomer],
    }).reason,
  ).toBe("unreviewed_id");
  expect(
    lookup(candidate)({ provider_id: "cohere", model_id: "command-a-plus-05-2026" }).status,
  ).toBe("matched");
});

it("preserves root-table identity when optional cards disappear but does not use cloud-only rows", async () => {
  const { candidate, facts } = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(
      ({ url }) => url === "https://docs.cohere.com/docs/models",
    );
  });
  expect(
    lookup(candidate)({ provider_id: "cohere", model_id: "command-a-plus-05-2026" }).status,
  ).toBe("matched");
  expect(facts.some(({ model_id }) => model_id === "command-nightly")).toBe(false);
  expect(facts.some(({ model_id }) => model_id === "command-light-nightly")).toBe(false);
});

it("accepts an independently declared card ID and withdraws it when both identity claims disappear", async () => {
  const removeOverviewId = (bundle: LinkedBundle) => {
    const overview = bundle.documents.find(
      ({ url }) => url === "https://docs.cohere.com/docs/models",
    );
    if (!overview) throw new Error("Missing overview");
    const $ = load(overview.body);
    $("tr")
      .filter((_index, row) => $(row).find("td").first().text() === "command-a-plus-05-2026")
      .remove();
    overview.body = $.html();
  };
  const { candidate: previous, facts } = await collect(removeOverviewId);
  expect(
    lookup(previous)({ provider_id: "cohere", model_id: "command-a-plus-05-2026" }).status,
  ).toBe("matched");
  expect(facts.filter(({ model_id }) => model_id === "command-a-plus-05-2026")).toHaveLength(1);
  const { candidate } = await collect((bundle) => {
    removeOverviewId(bundle);
    const card = bundle.documents.find(({ url }) => url.endsWith("/command-a-plus"));
    if (!card) throw new Error("Missing card");
    card.body = card.body.replaceAll("command-a-plus-05-2026", "unreviewed-deployment");
  }, previous);
  expect(
    lookup(candidate)({ provider_id: "cohere", model_id: "command-a-plus-05-2026" }).reason,
  ).toBe("unreviewed_id");
});

it("uses the same eligibility matching in the static website without audit data", async () => {
  const { candidate } = await collect();
  const projected = await projectCatalogPair(candidate);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()))
        .details.map(restoreWebsiteInferenceDetail),
    );
  const price = details.find(({ model_ref }) => model_ref === "cohere/command-r-plus-08-2024")
    ?.inference_prices?.[0];
  if (!price) throw new Error("Missing website mapping");
  expect(queryWebsiteInferencePrice(price, [], at).status).toBe("candidates");
  expect(queryWebsiteInferencePrice(price, [existingCustomer], at).status).toBe("matched");
  expect(JSON.stringify(price)).not.toContain("content_hash");
});
