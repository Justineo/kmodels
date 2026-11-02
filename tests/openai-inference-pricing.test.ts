import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vite-plus/test";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";
import { collectProvider } from "../src/catalog/collector.ts";
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
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset } from "../src/catalog/asset-pack.ts";
import { websiteDetailChunkSchema } from "../src/catalog/website-schema.ts";
import { queryWebsiteInferencePrice } from "../src/catalog/inference-price-presentation.ts";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import type { Catalog } from "../src/catalog/schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-07-21T00:00:00.000Z";
const fixture = (file: string) =>
  readFile(new URL(`./fixtures/openai/${file}`, import.meta.url), "utf8");
type Bundle = ReturnType<typeof linkedBundleSchema.parse>;
async function collect(
  change?: (input: { catalog: Bundle; pricing: string }) => void,
  previous?: CatalogPairCandidate,
) {
  const manifest: ProviderManifest | undefined = manifests.find(
    ({ provider }) => provider.id === "openai",
  );
  if (!manifest) throw new Error("Missing OpenAI manifest");
  const input = {
    catalog: linkedBundleSchema.parse(JSON.parse(await fixture("catalog.json"))),
    pricing: (await fixture("pricing.md")) + "\n" + (await fixture("fixed-search.md")),
  };
  change?.(input);
  const catalogSource = manifest.sources.find(({ id }) => id === "openai-models");
  const pricingSource = manifest.sources.find(({ id }) => id === "openai-pricing");
  if (!catalogSource || !pricingSource) throw new Error("Missing OpenAI sources");
  vi.mocked(fetchSource).mockImplementation(async (source) => {
    const body = source.id === "openai-models" ? JSON.stringify(input.catalog) : input.pricing;
    return {
      body,
      contentHash: sha256(body),
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  const result = await collectProvider(
    { ...manifest, sources: [catalogSource, pricingSource] },
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
function offer(candidate: CatalogPairCandidate, key: string, model = "openai/gpt-5.4") {
  const found = candidate.pricing.data.books.flatMap((book) =>
    book.offers.filter(
      (offer) =>
        offer.offer_key === key && (offer.model_refs ?? book.scope.model_refs).includes(model),
    ),
  )[0];
  if (!found) throw new Error(`Missing ${key} offer for ${model}`);
  return found.id;
}
const selectors: Selector[] = [
  {
    kind: "categorical",
    dimension: { namespace: "kmodels", value: "served_service_tier" },
    value: { namespace: "provider", provider_id: "openai", value: "standard" },
  },
  {
    kind: "decimal",
    dimension: { namespace: "kmodels", value: "context_tokens" },
    value: "1000",
    unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
  },
];

it("joins exact request IDs to canonical synchronous and Batch prices without API wiring", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const pending = query({ provider_id: "openai", model_id: "gpt-5.4" });
  expect(pending.status).toBe("candidates");
  expect(pending.requires_offer_choice).toBe(true);
  expect(new Set(pending.candidates.map(({ offer }) => offer.offer_key))).toEqual(
    new Set(["sync", "batch"]),
  );
  for (const [key, denominator] of [
    ["sync", "400000"],
    ["batch", "800000"],
  ] as const) {
    const result = query({
      provider_id: "openai",
      model_id: "gpt-5.4",
      selectors,
      offer_ref: offer(candidate, key),
    });
    expect(result.status).toBe("matched");
    expect(result.candidates).toHaveLength(1);
    expect(new Set(result.candidates[0]?.evidence.map(({ source_ref }) => source_ref))).toEqual(
      new Set(["openai-models", "openai-pricing"]),
    );
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator: "1", denominator }]);
  }
  expect(
    candidate.inference?.mapping.rules.every(({ fixed_selectors }) => fixed_selectors.length === 0),
  ).toBe(true);
  expect(query({ provider_id: "openai", model_id: "us.gpt-5.4" }).reason).toBe("unreviewed_id");
  expect(query({ provider_id: "openai", model_id: "ft:gpt-5.4:private:custom" }).reason).toBe(
    "unreviewed_id",
  );
  expect(
    query({ provider_id: "openai", model_id: "gpt-5.4", offer_ref: "0".repeat(64) }).reason,
  ).toBe("no_applicable_price");
});

it("keeps missing or excluded billing conditions distinct from an unknown ID", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  const args = { provider_id: "openai", model_id: "gpt-5.4", offer_ref: offer(candidate, "sync") };
  expect(query(args).status).toBe("candidates");
  expect(query(args).missing_conditions).toContainEqual({
    namespace: "kmodels",
    value: "served_service_tier",
  });
  expect(
    query({
      ...args,
      selectors: [
        {
          kind: "categorical",
          dimension: { namespace: "kmodels", value: "served_service_tier" },
          value: { namespace: "provider", provider_id: "openai", value: "fast" },
        },
        {
          kind: "decimal",
          dimension: { namespace: "kmodels", value: "context_tokens" },
          value: "1000000",
          unit: { factors: [{ unit: { namespace: "kmodels", value: "token" }, power: 1 }] },
        },
      ],
    }).reason,
  ).toBe("no_applicable_price");
});

it("preserves independent snapshot identity without copying the series tariff", async () => {
  const parent = await fixture("invocation-gpt-4.1.md");
  const add = (catalog: Bundle) => {
    catalog.index.body += "\n- [GPT-4.1](/api/docs/models/gpt-4.1.md): Deprecated";
    catalog.documents.push({
      url: "https://developers.openai.com/api/docs/models/gpt-4.1.md",
      body: parent,
    });
  };
  const candidate = await collect(({ catalog }) => add(catalog));
  const snapshot = candidate.catalog.models.find(
    ({ model_id }) => model_id === "gpt-4.1-2025-04-14",
  );
  expect(snapshot).toMatchObject({ status: "deprecated", aliases: [] });
  expect(snapshot?.version).toBeUndefined();
  expect(lookup(candidate)({ provider_id: "openai", model_id: "gpt-4.1-2025-04-14" }).reason).toBe(
    "unreviewed_id",
  );
  const explicit = await collect((input) => {
    add(input.catalog);
    input.pricing = input.pricing.replaceAll("gpt-5.4", "gpt-4.1-2025-04-14");
  });
  expect(
    lookup(explicit)({
      provider_id: "openai",
      model_id: "gpt-4.1-2025-04-14",
      selectors,
      offer_ref: offer(explicit, "sync", "openai/gpt-4.1-2025-04-14"),
    }).status,
  ).toBe("matched");
  expect(candidate.catalog.models.some(({ model_id }) => model_id === "gpt-5.4-2026-03-05")).toBe(
    false,
  );
});

it("does not treat routed aliases or snapshot list entries as evidence of identical pricing", async () => {
  const candidate = await collect(({ catalog }) => {
    const card = catalog.documents[0];
    if (!card) throw new Error("Missing card");
    card.body += "\nThe `controlled-alias` alias routes requests to GPT-5.4.\n";
  });
  const query = lookup(candidate);
  expect(query({ provider_id: "openai", model_id: "controlled-alias" }).reason).toBe(
    "unreviewed_id",
  );
  expect(query({ provider_id: "openai", model_id: "gpt-5.4-2026-03-05" }).reason).toBe(
    "unreviewed_id",
  );
});

it("preserves an independently indexed snapshot's own catalog facts", async () => {
  const parent = await fixture("invocation-gpt-4.1.md");
  const candidate = await collect(({ catalog }) => {
    catalog.index.body +=
      "\n- [GPT-4.1](/api/docs/models/gpt-4.1.md): Deprecated\n- [GPT-4.1 snapshot](/api/docs/models/gpt-4.1-2025-04-14.md): Deprecated";
    catalog.documents.push(
      { url: "https://developers.openai.com/api/docs/models/gpt-4.1.md", body: parent },
      {
        url: "https://developers.openai.com/api/docs/models/gpt-4.1-2025-04-14.md",
        body:
          parent
            .replace("Model ID: `gpt-4.1`", "Model ID: `gpt-4.1-2025-04-14`")
            .replace("1,047,576 context window", "123,456 context window")
            .split("## Snapshots")[0] ?? "",
      },
    );
  });
  expect(
    candidate.catalog.models.find(({ model_id }) => model_id === "gpt-4.1-2025-04-14")?.limits
      .context_tokens,
  ).toBe(123456);
});

it("rebuilds from independent current card and exact price-row evidence instead of retaining removed IDs", async () => {
  const previous = await collect();
  const missingCard = (catalog: Bundle) => {
    catalog.documents = [];
  };
  const pricesOnly = await collect(({ catalog }) => missingCard(catalog), previous);
  expect(
    lookup(pricesOnly)({
      provider_id: "openai",
      model_id: "gpt-5.4",
      selectors,
      offer_ref: offer(pricesOnly, "sync"),
    }).status,
  ).toBe("matched");
  const withdrawn = await collect((input) => {
    missingCard(input.catalog);
    input.pricing = input.pricing.replaceAll("gpt-5.4", "controlled-price-model");
  }, previous);
  expect(lookup(withdrawn)({ provider_id: "openai", model_id: "gpt-5.4" }).reason).toBe(
    "unreviewed_id",
  );
  expect(
    lookup(withdrawn)({ provider_id: "openai", model_id: "controlled-price-model" }).status,
  ).toBe("candidates");
});

it("projects the same ID, conditions and price selection to the website", async () => {
  const candidate = await collect();
  const projected = await projectCatalogPair(candidate);
  const details = projected.ui.manifest.assets.filter(({ file_name }) =>
    file_name.includes("details"),
  );
  const price = details
    .flatMap((asset) =>
      websiteDetailChunkSchema
        .parse(JSON.parse(gunzipSync(compressedAsset(projected.ui.pack, asset)).toString()))
        .details.map(restoreWebsiteInferenceDetail),
    )
    .find(({ model_ref }) => model_ref === "openai/gpt-5.4")
    ?.inference_prices?.find(({ model_id }) => model_id === "gpt-5.4");
  expect(price).toBeDefined();
  if (!price) throw new Error("Missing website ID price");
  const result = queryWebsiteInferencePrice(price, selectors, at, offer(candidate, "sync"));
  expect(result.status).toBe("matched");
  expect(result.missing_conditions).toEqual([]);
});
