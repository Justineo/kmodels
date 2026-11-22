import { vi } from "vite-plus/test";
import { readBoundedJson, verifiedCatalogEvidence } from "../scripts/replay-catalog-evidence.ts";
import { collectProvider } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import { priceDataExport } from "../src/catalog/pricing-lookup-export.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { failedPricingTransition } from "../src/catalog/pricing-transition.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";

vi.mock("../src/catalog/fetch.ts", async (original) => ({
  ...(await original<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

/** Run public provider captures through the collector, pair transition and portable lookup. */
export async function replayProviderEvidence(
  captures: Readonly<Record<string, string>>,
  previous?: CatalogPairCandidate,
) {
  const receipts = await Promise.all(
    Object.entries(captures).map(async ([sourceId, path]) =>
      verifiedCatalogEvidence(sourceId, await readBoundedJson(path)),
    ),
  );
  const manifest = receipts[0]?.manifest;
  if (!manifest || receipts.some((receipt) => receipt.manifest !== manifest))
    throw new Error("Replay requires full receipts from one provider");
  const bodies = new Map(receipts.map(({ evidence }) => [evidence.source_id, evidence]));
  const at = new Date(
    Math.max(...receipts.map(({ evidence }) => Date.parse(evidence.observed_at))),
  ).toISOString();
  vi.mocked(fetchSource).mockImplementation(async ({ id }) => {
    const capture = bodies.get(id);
    if (!capture) throw new Error(`Replay has no capture for ${id}`);
    return {
      body: capture.body,
      contentHash: capture.source_hash,
      etag: undefined,
      lastModified: undefined,
      dependencies: [],
    };
  });
  const result = await collectProvider(manifest, previous?.catalog, { sources: {} }, at);
  const pair = composeCatalogPair(
    previous?.catalog,
    {
      catalog_version: coreCatalogVersion([result.provider]),
      generated_at: at,
      providers: [result.provider],
      models: result.models,
      sources: result.sources,
      coverage: [result.coverage],
      warnings: result.warnings,
    },
    previous?.pricing.data ?? emptyPricingCatalog(),
    [
      result.pricing
        ? { kind: "fresh", partition: result.pricing }
        : failedPricingTransition(
            result.provider.id,
            at,
            result.pricingFailure ?? "pricing_not_observed",
          ),
    ],
  );
  const published = compileInferencePriceMapping(
    prepareCatalogPair(pair.catalog, pair.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
  const lookup = published.pricing.data.provider_snapshots.length
    ? createInferencePriceLookup(
        priceDataExport(published.catalog, published.pricing),
        published.inference?.mapping,
      )
    : undefined;
  return { attempt: result.attempt, published, lookup };
}
