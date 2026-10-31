import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { expect, it, vi } from "vite-plus/test";
import { deepseekBundle } from "./deepseek-fixture.ts";
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
import { failedPricingTransition } from "../src/catalog/pricing-transition.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Selector } from "../src/pricing/schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import type { Catalog } from "../src/catalog/schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-31T00:00:00.000Z";
type Bundle = Awaited<ReturnType<typeof deepseekBundle>>;
const fixture = (file: string) =>
  readFile(new URL(`./fixtures/deepseek/${file}`, import.meta.url), "utf8");
async function collect(change?: (bundle: Bundle) => void, previous?: CatalogPairCandidate) {
  const manifest = manifests.find(({ provider }) => provider.id === "deepseek");
  const source = manifest?.sources.find(({ id }) => id === "deepseek-catalog");
  if (!manifest || !source) throw new Error("Missing DeepSeek source");
  const bundle = await deepseekBundle(source);
  bundle.index.body = await fixture("inference-current.html");
  const cny = bundle.documents.find(({ url }) => url.includes("/zh-cn/"));
  if (!cny) throw new Error("Missing CNY source");
  cny.body = await fixture("inference-current-cny.html");
  change?.(bundle);
  const body = JSON.stringify(bundle);
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
  const result = await collectProvider(
    { ...manifest, sources: [source] },
    previous?.catalog,
    { sources: {} },
    at,
  );
  if (!result.pricing && !previous) throw new Error(JSON.stringify(result.attempt));
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
    [
      result.pricing
        ? { kind: "fresh", partition: result.pricing }
        : failedPricingTransition(
            "deepseek",
            at,
            result.pricingFailure ?? "provider_refresh_failed",
          ),
    ],
  );
  return compileInferencePriceMapping(
    prepareCatalogPair(composed.catalog, composed.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}
function selectors(currency = "USD", period = "off_peak"): Selector[] {
  return (
    [
      ["billing_currency", currency],
      ["billing_period", period],
    ] as const
  ).map(([dimension, value]) => ({
    kind: "categorical",
    dimension: { namespace: "kmodels", value: dimension },
    value: { namespace: "provider", provider_id: "deepseek", value },
  }));
}
function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    calculationExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

it("matches public and explicitly accepted legacy request IDs to their current canonical tariff", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  for (const model_id of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
    const result = query({ provider_id: "deepseek", model_id, selectors: selectors() });
    expect(result.status).toBe("matched");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.model_ref).toBe(`deepseek/${model_id}`);
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator: "3", denominator: "20000000" }]);
    expect(result.evidence).not.toEqual([]);
  }
  expect(
    candidate.inference?.mapping.rules.every(({ fixed_selectors }) => fixed_selectors.length === 0),
  ).toBe(true);
  for (const model_id of [
    "DeepSeek-V4.1-Flash-1017",
    "deepseek-chat",
    "us.deepseek-flash",
    "private-deployment",
  ]) {
    expect(query({ provider_id: "deepseek", model_id }).reason).toBe("unreviewed_id");
  }
});

it("requires explicit currency and billing period without choosing either from the ID or current clock", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const args = { provider_id: "deepseek", model_id: "deepseek-flash" };
  const pending = query(args);
  expect(pending.status).toBe("candidates");
  expect(pending.requires_offer_choice).toBe(false);
  expect(pending.missing_conditions).toEqual(
    expect.arrayContaining([
      { namespace: "kmodels", value: "billing_currency" },
      { namespace: "kmodels", value: "billing_period" },
    ]),
  );
  for (const [currency, period, numerator, denominator] of [
    ["USD", "off_peak", "3", "20000000"],
    ["USD", "peak", "3", "10000000"],
    ["CNY", "off_peak", "1", "1000000"],
    ["CNY", "peak", "1", "500000"],
  ] as const) {
    const result = query({ ...args, selectors: selectors(currency, period) });
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
  expect(query({ ...args, offer_ref: "0".repeat(64) }).reason).toBe("no_applicable_price");
});

it("keeps ID pricing independent of optional protocol and usage-reference availability", async () => {
  const candidate = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(
      ({ url }) => url.includes("/zh-cn/") || url.endsWith("/guides/search/"),
    );
  });
  expect(
    lookup(candidate)({
      provider_id: "deepseek",
      model_id: "deepseek-flash",
      selectors: selectors(),
    }).status,
  ).toBe("matched");
});

it.each(["removed", "billing changed"])(
  "withdraws %s legacy evidence without borrowing identical surviving prices",
  async (change) => {
    const previous = await collect();
    const next = await collect((bundle) => {
      const $ = load(bundle.index.body);
      const declaration = $("article p").filter((_, element) =>
        $(element).text().includes("The legacy names"),
      );
      if (change === "removed") declaration.remove();
      else
        declaration.html(
          (declaration.html() ?? "").replace(
            "and billed at the Flash price",
            "with unpublished billing",
          ),
        );
      bundle.index.body = $.html();
    }, previous);
    const query = lookup(next);
    expect(
      query({ provider_id: "deepseek", model_id: "deepseek-v4-flash", selectors: selectors() })
        .reason,
    ).toBe("unreviewed_id");
    expect(
      query({ provider_id: "deepseek", model_id: "deepseek-flash", selectors: selectors() }).status,
    ).toBe("matched");
  },
);

it("uses the same applicable price and compact evidence in the static website projection", async () => {
  const candidate = await collect();
  const projected = await projectCatalogPair(candidate);
  const price = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap(
      (asset) =>
        websiteDetailChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()),
        ).details,
    )
    .find(({ model_ref }) => model_ref === "deepseek/deepseek-flash")
    ?.inference_prices?.find(({ model_id }) => model_id === "deepseek-flash");
  if (!price) throw new Error("Missing website ID prices");
  expect(queryWebsiteInferencePrice(price, selectors(), at).status).toBe("matched");
  expect(queryWebsiteInferencePrice(price, [], at).status).toBe("candidates");
  expect(price.evidence_urls).toContain("https://api-docs.deepseek.com/quick_start/pricing/");
  expect(JSON.stringify(price)).not.toContain("content_hash");
});
