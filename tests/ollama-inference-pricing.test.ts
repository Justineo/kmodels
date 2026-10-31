import { gunzipSync } from "node:zlib";
import { beforeAll, expect, it, vi } from "vite-plus/test";
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
import type { Selector } from "../src/pricing/schema.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import { ollamaInferenceFixtures, type OllamaInferenceBundle } from "./ollama-inference-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-10-30T18:50:00.000Z";
async function collect(
  change?: (bundle: OllamaInferenceBundle) => void,
  previous?: CatalogPairCandidate,
) {
  const manifest = manifests.find(({ provider }) => provider.id === "ollama");
  const catalog = manifest?.sources.find(({ id }) => id === "ollama-cloud-models");
  if (!manifest || !catalog) throw new Error("Missing Vercel source");
  const library = manifest.sources.find(({ id }) => id === "ollama-library");
  if (!library) throw new Error("Missing Ollama Library");
  const fixtures = await ollamaInferenceFixtures();
  change?.(fixtures.cloud);
  const bodies = new Map([
    [catalog.id, JSON.stringify(fixtures.cloud)],
    [library.id, fixtures.library],
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
    { ...manifest, sources: [library, catalog] },
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
let baseline: CatalogPairCandidate;
beforeAll(async () => {
  baseline = (await collect()).candidate;
}, 15000);

function lookup(candidate: CatalogPairCandidate) {
  return createInferencePriceLookup(
    calculationExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

function period(value: string): Selector {
  return {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "billing_period" },
    value: { namespace: "provider", provider_id: "ollama", value },
  };
}
function inputPrices(result: ReturnType<ReturnType<typeof lookup>>) {
  return result.candidates.flatMap(({ offer }) =>
    offer.terms.flatMap((term) =>
      term.kind === "rate" && term.meter.value === "input_text"
        ? term.variants.map(({ price }) => price.value)
        : [],
    ),
  );
}

it("associates the exact Cloud API IDs with existing public token prices", () => {
  const query = lookup(baseline);
  for (const [model_id, numerator, denominator] of [
    ["kimi-k3", "3", "1000000"],
    ["gpt-oss:20b", "7", "100000000"],
  ] as const) {
    const result = query({ provider_id: "ollama", model_id });
    expect(result.status).toBe("matched");
    expect(result.missing_conditions).toEqual([]);
    expect(result.requires_offer_choice).toBe(false);
    expect(inputPrices(result)).toEqual([{ numerator, denominator }]);
    expect(result.candidates.map(({ offer }) => offer.offer_key)).toEqual(["cloud-inference"]);
  }
  expect(baseline.pricing.data.books.every((book) => book.scope.kind === "models")).toBe(true);
});

it("keeps Peak and Off-peak as explicit billing conditions rather than using the lookup clock", () => {
  const query = lookup(baseline);
  const args = { provider_id: "ollama", model_id: "deepseek-v4.1-flash" };
  const result = query(args);
  expect(result.status).toBe("candidates");
  expect(result.missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "billing_period",
  });
  for (const [value, numerator, denominator] of [
    ["peak", "3", "10000000"],
    ["off_peak", "3", "20000000"],
  ] as const) {
    const result = query({ ...args, selectors: [period(value)] });
    expect(result.status).toBe("matched");
    expect(inputPrices(result)).toEqual([{ numerator, denominator }]);
  }
});

it("does not manufacture CLI aliases, local prices, or family-to-size tariffs", () => {
  const query = lookup(baseline);
  for (const model_id of [
    "kimi-k3:cloud",
    "kimi-k3-cloud",
    "gemma4",
    "gemma4:cloud",
    "gemma4:31b",
    "gpt-oss",
    "private-model",
  ])
    expect(query({ provider_id: "ollama", model_id }).reason).toBe("unreviewed_id");
  const offer = query({ provider_id: "ollama", model_id: "kimi-k3" }).candidates[0]?.offer.id;
  expect(offer).toBeDefined();
  expect(query({ provider_id: "ollama", model_id: "gpt-oss:20b", offer_ref: offer }).reason).toBe(
    "no_applicable_price",
  );
});

it("withdraws an API ID while preserving independently witnessed catalog prices", async () => {
  const { candidate } = await collect((bundle) => {
    bundle.list.models = bundle.list.models.filter(({ model }) => model !== "kimi-k3");
  }, baseline);
  expect(candidate.catalog.models.some(({ model_id }) => model_id === "kimi-k3")).toBe(true);
  expect(
    candidate.pricing.data.books.some((book) => book.scope.model_refs?.includes("ollama/kimi-k3")),
  ).toBe(true);
  expect(lookup(candidate)({ provider_id: "ollama", model_id: "kimi-k3" }).reason).toBe(
    "unreviewed_id",
  );
});

it("keeps Cloud retirement distinct from a surviving Library identity", async () => {
  const { candidate } = await collect((bundle) => {
    bundle.details.push({
      model: "kimi-k3",
      status: 410,
      body: { error: "kimi-k3 was retired at 2026-10-29 and is no longer available" },
    });
  });
  expect(candidate.catalog.models.find(({ model_id }) => model_id === "kimi-k3")?.status).toBe(
    "active",
  );
  expect(lookup(candidate)({ provider_id: "ollama", model_id: "kimi-k3" }).reason).toBe(
    "unreviewed_id",
  );
  expect(lookup(candidate)({ provider_id: "ollama", model_id: "gpt-oss:20b" }).status).toBe(
    "matched",
  );
});

it("does not depend on Show, usage or protocol guides for independently established rates", async () => {
  const { candidate } = await collect((bundle) => {
    bundle.documents = bundle.documents.filter(({ url }) => url === "https://ollama.com/pricing");
    bundle.details = [];
  });
  expect(lookup(candidate)({ provider_id: "ollama", model_id: "kimi-k3" }).status).toBe("matched");
});

it("projects the same ID and period conditions to the website without audit data", async () => {
  const projected = await projectCatalogPair(baseline);
  const details = projected.ui.manifest.assets
    .filter(({ file_name }) => file_name.includes("/details/"))
    .flatMap(
      (asset) =>
        websiteDetailChunkSchema.parse(
          JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()),
        ).details,
    );
  const price = details.find(({ model_ref }) => model_ref === "ollama/deepseek-v4.1-flash")
    ?.inference_prices?.[0];
  if (!price) throw new Error("Missing website inference price");
  expect(price.model_id).toBe("deepseek-v4.1-flash");
  expect(queryWebsiteInferencePrice(price, [], at).status).toBe("candidates");
  expect(queryWebsiteInferencePrice(price, [period("off_peak")], at).status).toBe("matched");
  expect(JSON.stringify(price)).not.toMatch(/content_hash|invocation_target/);
});
