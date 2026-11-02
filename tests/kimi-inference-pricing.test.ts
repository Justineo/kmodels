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
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { InferencePriceQuery } from "../src/pricing/inference-schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import { kimiInferenceBundle } from "./kimi-inference-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T17:30:00.000Z";

async function collect(
  change?: (bundle: LinkedBundle, sourceId: string) => void,
  previous?: CatalogPairCandidate,
) {
  const manifest = manifests.find(({ provider }) => provider.id === "kimi");
  if (!manifest) throw new Error("Missing Kimi manifest");
  const china = manifest.sources.find(({ id }) => id === "kimi-pricing");
  const international = manifest.sources.find(({ id }) => id === "kimi-international-pricing");
  if (!china || !international) throw new Error("Missing regional pricing sources");
  const sources = [china, international] as const;
  const bodies = new Map(
    await Promise.all(
      sources.map(async (source) => {
        const bundle = await kimiInferenceBundle(source);
        change?.(bundle, source.id);
        return [source.id, JSON.stringify(bundle)] as const;
      }),
    ),
  );
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
    { ...manifest, sources: [china, international] },
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
  return compileInferencePriceMapping(
    prepareCatalogPair(composed.catalog, composed.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}
function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    calculationExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}
function selectors(region: string, ttl?: string): NonNullable<InferencePriceQuery["selectors"]> {
  return [
    {
      kind: "categorical",
      dimension: { namespace: "kmodels", value: "region" },
      value: { namespace: "provider", provider_id: "kimi", value: region },
    },
    ...(ttl === undefined
      ? []
      : [
          {
            kind: "decimal" as const,
            dimension: { namespace: "kmodels" as const, value: "cache_ttl_seconds" as const },
            value: ttl,
            unit: {
              factors: [
                { unit: { namespace: "kmodels" as const, value: "second" as const }, power: 1 },
              ],
            },
          },
        ]),
  ];
}
function offerRef(candidate: CatalogPairCandidate, id: string, key: string): string {
  const offer = candidate.pricing.data.books
    .find(({ scope }) => scope.kind === "models" && scope.model_refs.includes(`kimi/${id}`))
    ?.offers.find(({ offer_key }) => offer_key === key);
  if (!offer) throw new Error(`Missing ${id} ${key} offer`);
  return offer.id;
}

it("keeps region, inference offer and cache TTL explicit for an exact Kimi ID", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const args = { provider_id: "kimi", model_id: "kimi-k3" };
  const pending = query(args);
  expect(pending.status).toBe("candidates");
  expect(pending.requires_offer_choice).toBe(true);
  expect(pending.missing_conditions).toEqual(
    expect.arrayContaining([
      { namespace: "kmodels", value: "region" },
      { namespace: "kmodels", value: "cache_ttl_seconds" },
    ]),
  );
  for (const [region, key, numerator, denominator] of [
    ["China", "sync", "1", "50000"],
    ["International", "sync", "3", "1000000"],
    ["China", "batch", "3", "250000"],
    ["International", "batch", "9", "5000000"],
  ]) {
    if (!region || !key) throw new Error("Missing test case");
    const result = query({
      ...args,
      offer_ref: offerRef(candidate, args.model_id, key),
      selectors: selectors(region, "300"),
    });
    expect(result.status).toBe("matched");
    expect(result.candidates).toHaveLength(1);
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
    candidate.inference?.mapping.rules.every(({ fixed_selectors }) => fixed_selectors.length === 0),
  ).toBe(true);
});

it("keeps highspeed as a distinct request ID and omits unpublished cache-write rates", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const fast = query({
    provider_id: "kimi",
    model_id: "kimi-k2.7-code-highspeed",
    selectors: selectors("International"),
  });
  expect(fast.status).toBe("matched");
  expect(fast.requires_offer_choice).toBe(false);
  expect(fast.candidates[0]?.model_ref).toBe("kimi/kimi-k2.7-code-highspeed");
  const batch = query({
    provider_id: "kimi",
    model_id: "kimi-k2.6",
    selectors: selectors("International"),
    offer_ref: offerRef(candidate, "kimi-k2.6", "batch"),
  });
  expect(batch.status).toBe("matched");
  expect(
    batch.candidates
      .flatMap(({ offer }) => offer.terms)
      .some((term) => term.kind === "rate" && term.meter.value === "cache_write_text"),
  ).toBe(false);
  for (const model_id of ["kimi-k3.1", "cn.kimi-k3", "kimi-k3-highspeed", "private-deployment"])
    expect(query({ provider_id: "kimi", model_id }).reason).toBe("unreviewed_id");
  expect(() =>
    query({ provider_id: "kimi", model_id: "kimi-k3", selectors: selectors("unreviewed-region") }),
  ).toThrow("Unregistered categorical value");
});

it("withdraws a regional price without letting the surviving regional mapping restore it", async () => {
  const previous = await collect();
  const next = await collect((bundle, sourceId) => {
    if (sourceId === "kimi-pricing")
      bundle.index.body = bundle.index.body.replaceAll("kimi-k2.7-code-highspeed", " ");
  }, previous);
  const query = lookup(next);
  expect(
    query({
      provider_id: "kimi",
      model_id: "kimi-k2.7-code-highspeed",
      selectors: selectors("China"),
    }).reason,
  ).toBe("no_applicable_price");
  expect(
    query({
      provider_id: "kimi",
      model_id: "kimi-k2.7-code-highspeed",
      selectors: selectors("International"),
    }).status,
  ).toBe("matched");
  const removed = await collect((bundle) => {
    bundle.index.body = bundle.index.body.replaceAll("kimi-k2.7-code-highspeed", " ");
  }, next);
  expect(
    lookup(removed)({ provider_id: "kimi", model_id: "kimi-k2.7-code-highspeed" }).reason,
  ).toBe("unreviewed_id");
});

it("rejects Batch labels on synchronous pages and malformed output prices without erasing siblings", async () => {
  const mislabeled = await collect((bundle) => {
    bundle.index.body = bundle.index.body.replaceAll(
      "kimi-k2.7-code-highspeed",
      "kimi-k2.7-code-highspeed (Batch)",
    );
  });
  expect(
    lookup(mislabeled)({ provider_id: "kimi", model_id: "kimi-k2.7-code-highspeed" }).reason,
  ).toBe("unreviewed_id");
  const malformed = await collect((bundle, sourceId) => {
    if (sourceId !== "kimi-international-pricing") return;
    const quoted = "`$1.90 / MTok`,`$8.00 / MTok`";
    expect(bundle.index.body).toContain(quoted);
    bundle.index.body = bundle.index.body.replaceAll(quoted, "`$1.90 / MTok`,`—`");
  });
  const query = lookup(malformed);
  expect(
    query({
      provider_id: "kimi",
      model_id: "kimi-k2.7-code-highspeed",
      selectors: selectors("International"),
    }).reason,
  ).toBe("no_applicable_price");
  expect(
    query({
      provider_id: "kimi",
      model_id: "kimi-k2.7-code-highspeed",
      selectors: selectors("China"),
    }).status,
  ).toBe("matched");
});

it("uses the same regional and offer matching in static UI output without protocol sources", async () => {
  const candidate = await collect();
  const projected = await projectCatalogPair(candidate);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()))
        .details.map(restoreWebsiteInferenceDetail),
    );
  const price = details
    .find(({ model_ref }) => model_ref === "kimi/kimi-k3")
    ?.inference_prices?.find(({ model_id }) => model_id === "kimi-k3");
  if (!price) throw new Error("Missing website mapping");
  expect(queryWebsiteInferencePrice(price, [], at).status).toBe("candidates");
  expect(
    queryWebsiteInferencePrice(
      price,
      selectors("International", "3600"),
      at,
      offerRef(candidate, "kimi-k3", "batch"),
    ).status,
  ).toBe("matched");
  expect(JSON.stringify(price)).not.toContain("content_hash");
});
