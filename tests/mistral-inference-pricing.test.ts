import { gunzipSync } from "node:zlib";
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
import { mistralInferenceBundles } from "./mistral-inference-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T18:10:00.000Z";
async function collect(change?: (bundle: LinkedBundle) => void, previous?: CatalogPairCandidate) {
  const manifest = manifests.find(({ provider }) => provider.id === "mistral");
  const catalog = manifest?.sources.find(({ id }) => id === "mistral-models");
  const pricing = manifest?.sources.find(({ id }) => id === "mistral-pricing");
  if (!manifest || !catalog || !pricing) throw new Error("Missing Mistral sources");
  const bundles = await mistralInferenceBundles();
  change?.(bundles.catalog);
  const bodies = new Map([
    [catalog.id, JSON.stringify(bundles.catalog)],
    [pricing.id, JSON.stringify(bundles.pricing)],
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

function categorical(
  dimension: "billing_currency" | "served_service_tier" | "endpoint" | "operation",
  value: string,
): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "mistral", value },
  };
}
const standard = [
  categorical("billing_currency", "USD"),
  categorical("served_service_tier", "standard"),
];
function offerRef(query: ReturnType<typeof lookup>, model_id: string, key: string) {
  const offer = query({
    provider_id: "mistral",
    model_id,
    execution_mode: key === "batch" ? "batch" : "request",
  }).candidates[0]?.offer;
  if (!offer) throw new Error(`Missing ${model_id} ${key}`);
  return offer.id;
}

it("maps actual Mistral API names and declared aliases while leaving invented IDs unknown", async () => {
  const { candidate, facts } = await collect();
  const query = lookup(candidate);
  for (const model_id of ["mistral-large-4", "mistral-large-4-0"]) {
    const result = query({ provider_id: "mistral", model_id });
    expect(result.status).toBe("candidates");
    expect(result.candidates.map(({ offer }) => offer.offer_key).sort()).toEqual([
      "public",
      "public",
    ]);
    expect(result.candidates.map(({ offer }) => offer.id)).toEqual(
      query({ provider_id: "mistral", model_id: "mistral-large-4" }).candidates.map(
        ({ offer }) => offer.id,
      ),
    );
  }
  expect(facts.every(({ fixed_selectors }) => fixed_selectors.length === 0)).toBe(true);
  for (const model_id of [
    "mistral-large-4-latest",
    "eu.mistral-large-4",
    "Mistral Large 4",
    "ft:private-model",
    "codestral-2405",
    "shieldstral-1-0",
  ])
    expect(query({ provider_id: "mistral", model_id }).reason).toBe("unreviewed_id");
});

it("selects actual currency and served tier over shared synchronous and Batch prices", async () => {
  const { candidate } = await collect();
  const query = lookup(candidate);
  const args = { provider_id: "mistral", model_id: "mistral-large-4-0" };
  for (const [key, currency, tier, numerator, denominator] of [
    ["sync", "USD", "standard", "7", "10000000"],
    ["sync", "USD", "priority", "49", "40000000"],
    ["sync", "EUR", "standard", "119", "200000000"],
    ["batch", "USD", "", "7", "20000000"],
  ] as const) {
    const result = query({
      ...args,
      offer_ref: offerRef(query, args.model_id, key),
      execution_mode: key === "batch" ? "batch" : "request",
      selectors: [
        categorical("billing_currency", currency),
        ...(tier
          ? [
              categorical("served_service_tier", tier),
              categorical("endpoint", "/v1/chat/completions"),
            ]
          : []),
      ],
    });
    expect(result.status).toBe("matched");
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator, denominator }]);
  }
  expect(
    query({
      ...args,
      offer_ref: offerRef(query, args.model_id, "sync"),
      execution_mode: "request",
      selectors: [categorical("billing_currency", "USD")],
    }).missing_conditions,
  ).toContainEqual({ namespace: "kmodels", value: "served_service_tier" });
  expect(
    query({
      provider_id: "mistral",
      model_id: "mistral-ocr-4-1",
      offer_ref: offerRef(query, "mistral-ocr-4-1", "sync"),
      execution_mode: "request",
      selectors: [
        categorical("billing_currency", "USD"),
        categorical("served_service_tier", "priority"),
      ],
    }).reason,
  ).toBe("no_applicable_price");
});

it("preserves free moderation and model-specific page and audio units without borrowing tool tariffs", async () => {
  const { candidate } = await collect();
  const query = lookup(candidate);
  expect(query({ provider_id: "mistral", model_id: "mistral-moderation-2603" }).status).toBe(
    "matched",
  );
  for (const [model_id, meter, selectors, numerator, denominator] of [
    ["mistral-ocr-4-1", "input_image", [...standard, categorical("operation", "ocr")], "1", "250"],
    ["voxtral-mini-tts-3-0", "input_text", standard, "13", "1000000"],
  ] as const) {
    const result = query({
      provider_id: "mistral",
      model_id,
      offer_ref: offerRef(query, model_id, "sync"),
      execution_mode: "request",
      selectors: [...selectors],
    });
    // Published cached non-token cells have no reviewed meter; their unknowns remain visible.
    expect(result.status).toBe("candidates");
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === meter
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator, denominator }]);
    expect(
      result.candidates.some(({ gaps }) =>
        gaps.some(({ code }) => code === "unsupported_structure"),
      ),
    ).toBe(true);
  }
});

it("withdraws an alias from fresh catalog evidence even when central prices remain", async () => {
  const { candidate: previous } = await collect();
  const { candidate } = await collect((bundle) => {
    const card = bundle.documents.find(({ url }) => url.endsWith("/mistral-large-4-0.md"));
    if (!card) throw new Error("Missing model card");
    card.body = card.body.replace(", `mistral-large-4-0`", "");
  }, previous);
  expect(lookup(candidate)({ provider_id: "mistral", model_id: "mistral-large-4-0" }).reason).toBe(
    "unreviewed_id",
  );
  expect(lookup(candidate)({ provider_id: "mistral", model_id: "mistral-large-4" }).status).toBe(
    "candidates",
  );
});

it("withholds a conflicting card identity while preserving sibling models", async () => {
  const { candidate: previous } = await collect();
  const { candidate } = await collect((bundle) => {
    const card = bundle.documents.find(({ url }) => url.endsWith("/mistral-large-4-0.md"));
    if (!card) throw new Error("Missing model card");
    card.body = card.body.replace(
      "API names: `mistral-large-4`",
      "API names: `private-deployment`",
    );
  }, previous);
  expect(lookup(candidate)({ provider_id: "mistral", model_id: "mistral-large-4" }).reason).toBe(
    "unreviewed_id",
  );
  expect(
    lookup(candidate)({ provider_id: "mistral", model_id: "mistral-small-2603" }).candidates.length,
  ).toBeGreaterThan(0);
});

it("keeps direct ID facts when optional discount companions are absent", async () => {
  const { facts } = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(({ url }) => url.includes("/models/"));
  });
  expect(facts.some(({ model_id }) => model_id === "mistral-large-4-0")).toBe(true);
});

it("shares exact ID matching with the static UI while keeping audit data out", async () => {
  const { candidate } = await collect();
  const projected = await projectCatalogPair(candidate);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap(
      (asset) =>
        websiteDetailChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()),
        ).details,
    )
    .map(restoreWebsiteInferenceDetail);
  const model = candidate.catalog.models.find(({ model_id }) => model_id === "mistral-large-4");
  const price = details
    .find(({ model_ref }) => model_ref === model?.uid)
    ?.inference_prices?.find(({ model_id }) => model_id === "mistral-large-4-0");
  if (!price) throw new Error("Missing website mapping");
  expect(queryWebsiteInferencePrice(price, [], at).status).toBe("candidates");
  expect(
    queryWebsiteInferencePrice(
      price,
      [...standard, categorical("endpoint", "/v1/chat/completions")],
      at,
      offerRef(lookup(candidate), "mistral-large-4-0", "sync"),
      "request",
    ).status,
  ).toBe("matched");
  expect(JSON.stringify(price)).not.toContain("content_hash");
});
