import { expect, it, vi } from "vite-plus/test";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { sha256 } from "../src/catalog/io.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import type { Catalog } from "../src/catalog/schema.ts";
import {
  embeddingId,
  fireworksBundle,
  rerankerAlias,
  rerankerId,
  routerId,
} from "./fireworks-fixture.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));
const at = "2026-11-12T00:00:00.000Z";

async function collect(previous?: CatalogPairCandidate) {
  const manifest = manifests.find(({ provider }) => provider.id === "fireworks");
  const source = manifest?.sources[0];
  if (!manifest || !source) throw new Error("Missing Fireworks source");
  const body = JSON.stringify(fireworksBundle);
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
    priceDataExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  );
}

function inputRate(candidate: CatalogPairCandidate, modelRef: string) {
  return candidate.pricing.data.books
    .filter(({ scope }) => scope.model_refs.includes(modelRef))
    .flatMap(({ offers }) => offers)
    .flatMap(({ terms }) => terms)
    .flatMap((term) =>
      term.kind === "rate" && term.meter.value === "input_text"
        ? term.variants.map(({ price }) => price.value)
        : [],
    );
}

it("bills a retrieval card with a single per-token unit as its input rate", async () => {
  const candidate = await collect();
  const query = lookup(candidate);
  for (const model_id of [rerankerId, rerankerAlias]) {
    const result = query({ provider_id: "fireworks", model_id });
    expect(result.status).toBe("matched");
    expect(result.missing_conditions).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(
      result.candidates.flatMap(({ offer }) =>
        offer.terms.flatMap((term) =>
          term.kind === "rate" && term.meter.value === "input_text"
            ? term.variants.map(({ price }) => price.value)
            : [],
        ),
      ),
    ).toEqual([{ numerator: "1", denominator: "5000000" }]);
  }
  expect(query({ provider_id: "fireworks", model_id: embeddingId }).status).toBe("matched");
  expect(
    query({ provider_id: "fireworks", model_id: "fireworks/unreviewed-reranker" }),
  ).toMatchObject({ status: "unknown", reason: "unreviewed_id" });
});

it("publishes the accepted retrieval rate without inventing one for an unreviewed ref", async () => {
  const candidate = await collect();
  expect(inputRate(candidate, `fireworks/${rerankerId}`)).toEqual([
    { numerator: "1", denominator: "5000000" },
  ]);
  expect(candidate.inference?.mapping.rules.map(({ model_id }) => model_id)).toEqual(
    expect.arrayContaining([rerankerAlias]),
  );
  expect(inputRate(candidate, "fireworks/unreviewed-reranker")).toEqual([]);
  expect(lookup(candidate)({ provider_id: "fireworks", model_id: routerId }).status).toBe(
    "matched",
  );
  expect(candidate.catalog.models.map(({ model_id }) => model_id)).toEqual(
    expect.arrayContaining([rerankerId, routerId]),
  );
});
