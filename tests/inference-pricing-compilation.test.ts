import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vite-plus/test";
import { collectProvider, pricingCompilationEntries } from "../src/catalog/collector.ts";
import { fetchSource } from "../src/catalog/fetch.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { sha256 } from "../src/catalog/io.ts";
import { composeCatalogPair, coreCatalogVersion } from "../src/catalog/pricing-pair-transition.ts";
import {
  prepareCatalogPair,
  type CatalogPairCandidate,
} from "../src/catalog/pricing-publication.ts";
import { compileInferencePriceMapping } from "../src/catalog/inference-pricing-compilation.ts";
import {
  createPricingCompilationSnapshot,
  compilePricingSnapshot,
} from "../src/catalog/pricing-compilation.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { failedPricingTransition } from "../src/catalog/pricing-transition.ts";
import { calculationExport } from "../src/catalog/pricing-calculator-export.ts";
import { createInferencePriceLookup } from "../src/pricing/inference.ts";
import { projectCatalogPair } from "../src/catalog/projections.ts";
import { compressedAsset, type EncodedAssetPack } from "../src/catalog/asset-pack.ts";
import {
  websiteDetailChunkSchema,
  websiteOfferChunkSchema,
} from "../src/catalog/website-schema.ts";
import { renderComponent } from "./render-component.ts";
import InferencePrices from "../src/components/InferencePrices.vue";
import { restoreWebsiteInferenceDetail } from "./website-inference-detail.ts";
import type { Catalog } from "../src/catalog/schema.ts";

vi.mock("../src/catalog/fetch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/catalog/fetch.ts")>()),
  fetchSource: vi.fn(),
}));

const manifest = manifests.find(({ provider }) => provider.id === "typesafe");
if (!manifest) throw new Error("Missing TypeSafe manifest");
const at = "2026-10-30T00:00:00.000Z";
const later = "2026-10-31T00:00:00.000Z";
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/typesafe/${name}`, import.meta.url), "utf8");
type Collected = Awaited<ReturnType<typeof collectProvider>>;

async function collect(models?: string, previous?: CatalogPairCandidate): Promise<Collected> {
  const body = JSON.stringify({
    index: {
      url: "https://docs.typesafe.ai/models.md",
      body: models ?? (await fixture("models-id-pricing.md")),
    },
    documents: [
      { url: "https://docs.typesafe.ai/llms.txt", body: await fixture("llms.txt") },
      { url: "https://docs.typesafe.ai/api.md", body: await fixture("api.md") },
    ],
  });
  vi.mocked(fetchSource).mockResolvedValue({
    body,
    contentHash: sha256(body),
    etag: undefined,
    lastModified: undefined,
    dependencies: [],
  });
  if (!manifest) throw new Error("Missing provider");
  return collectProvider(
    manifest,
    previous?.catalog,
    { sources: {} },
    previous === undefined ? at : later,
  );
}

function pair(
  result: Collected,
  previous?: CatalogPairCandidate,
  retainPrice = false,
): CatalogPairCandidate {
  const catalog: Catalog = {
    catalog_version: coreCatalogVersion([result.provider]),
    generated_at: previous === undefined ? at : later,
    providers: [result.provider],
    models: result.models,
    sources: result.sources,
    coverage: [result.coverage],
    warnings: result.warnings,
  };
  const composed = composeCatalogPair(
    previous?.catalog,
    catalog,
    previous?.pricing.data ?? emptyPricingCatalog(),
    [
      result.pricing === undefined || retainPrice
        ? failedPricingTransition("typesafe", catalog.generated_at, "source_unavailable")
        : { kind: "fresh", partition: result.pricing },
    ],
  );
  return compileInferencePriceMapping(
    prepareCatalogPair(composed.catalog, composed.pricing),
    result.inferencePriceSources ?? [],
    previous,
  );
}

function lookup(candidate: CatalogPairCandidate, model_id: string) {
  return createInferencePriceLookup(
    calculationExport(candidate.catalog, candidate.pricing),
    candidate.inference?.mapping,
  )({ provider_id: "typesafe", model_id });
}

function asset(pack: EncodedAssetPack, fileName: string): unknown {
  const entry = pack.manifest.assets.find(({ file_name }) => file_name === fileName);
  if (!entry) throw new Error(`Missing asset ${fileName}`);
  return JSON.parse(gunzipSync(compressedAsset(pack.pack, entry)).toString("utf8"));
}

describe("direct inference price source-to-consumer compilation", () => {
  it("collects official TypeSafe IDs and exposes the same prices through static output and UI", async () => {
    const result = await collect();
    expect(result.coverage.status).toBe("fresh");
    expect(result.pricing).toBeDefined();
    const candidate = pair(result);
    const projected = await projectCatalogPair(candidate);
    const mapping = asset(projected.exports, "pricing/inference.json");
    const prices = asset(projected.exports, "pricing/calculation/providers/typesafe.json");
    const publicLookup = createInferencePriceLookup(prices, mapping);
    for (const model_id of ["jev-1.13.0", "jev-1.14.0", "jev-latest", "jev-preview"]) {
      const match = publicLookup({ provider_id: "typesafe", model_id });
      expect(match.status).toBe("matched");
      expect(match.missing_conditions).toEqual([]);
      expect(
        match.candidates.flatMap(({ offer }) =>
          offer.terms.flatMap((term) =>
            term.kind === "rate" ? term.variants.map(({ price }) => price.value) : [],
          ),
        ),
      ).toEqual(
        expect.arrayContaining([
          { numerator: "21", denominator: "500000000" },
          { numerator: "0", denominator: "1" },
        ]),
      );
    }
    const details = projected.ui.manifest.assets
      .filter(({ file_name }) => file_name.includes("/details/"))
      .flatMap(({ file_name }) =>
        websiteDetailChunkSchema
          .parse(asset(projected.ui, file_name))
          .details.map(restoreWebsiteInferenceDetail),
      );
    const offers = projected.ui.manifest.assets
      .filter(({ file_name }) => file_name.includes("/offers/"))
      .flatMap(
        ({ file_name }) => websiteOfferChunkSchema.parse(asset(projected.ui, file_name)).offers,
      );
    const detail = details.find(({ model_ref }) => model_ref === "typesafe/jev-1.14.0");
    expect(detail?.inference_prices?.map(({ model_id }) => model_id)).toEqual([
      "jev-1.14.0",
      "jev-latest",
      "jev-preview",
    ]);
    const html = await renderComponent(InferencePrices, {
      modelRef: "typesafe/jev-1.14.0",
      prices: detail?.inference_prices ?? [],
      offers,
    });
    expect(html).toContain("Applicable prices");
    expect(html).toContain("Copy inference model ID jev-1.14.0");
    expect(html).toContain("$0.042");
    expect(html).not.toContain("Pricing options");
    expect(html).not.toContain("Inspect target");
    expect(JSON.stringify(detail)).not.toContain("content_hash");
    expect(JSON.stringify(detail)).not.toContain("observations");
  });

  it("replays captured direct associations without rebuilding an invocation graph", async () => {
    const collected = await collect();
    const current = pair(collected);
    const snapshot = createPricingCompilationSnapshot(
      current,
      pricingCompilationEntries(current, [collected], new Set(), undefined),
    );
    const compiled = await compilePricingSnapshot(current, snapshot);
    expect(compiled.replayedProviders).toEqual(["typesafe"]);
    expect(compiled.candidate.inference).toEqual(current.inference);
    expect(lookup(compiled.candidate, "jev-latest").candidates[0]?.model_ref).toBe(
      "typesafe/jev-1.14.0",
    );
  });

  it("replaces a moved or withdrawn alias independently of equal prices and retained display aliases", async () => {
    const previous = pair(await collect());
    const models = await fixture("models-id-pricing.md");
    const moved = models.replace(/(`jev-latest`\s*\|\s*)`jev-1\.14\.0`/, "$1`jev-1.13.0`");
    const current = pair(await collect(moved, previous), previous);
    expect(lookup(current, "jev-latest").candidates[0]?.model_ref).toBe("typesafe/jev-1.13.0");
    const removed = moved
      .split("\n")
      .filter((line) => !line.includes("| `jev-latest`"))
      .join("\n");
    const withdrawn = pair(await collect(removed, current), current);
    expect(lookup(withdrawn, "jev-latest")).toMatchObject({
      status: "unknown",
      reason: "unreviewed_id",
    });
    expect(lookup(withdrawn, "jev-1.14.0").status).toBe("matched");
  });

  it("retains verified mappings during a source outage but rejects changed uncaptured evidence", async () => {
    const previous = pair(await collect());
    vi.mocked(fetchSource).mockRejectedValue(new Error("fixture outage"));
    if (!manifest) throw new Error("Missing provider");
    const failed = await collectProvider(manifest, previous.catalog, { sources: {} }, later);
    const retained = pair(failed, previous);
    expect(lookup(retained, "jev-latest")).toMatchObject({
      status: "matched",
      freshness: { publication: "retained" },
    });
    const changedCatalog = structuredClone(retained.catalog);
    const source = changedCatalog.sources[0];
    if (!source) throw new Error("Missing source");
    source.content_hash = sha256("changed identity evidence");
    source.observed_at = later;
    const changed = compileInferencePriceMapping(
      prepareCatalogPair(changedCatalog, retained.pricing.data),
      [],
      retained,
    );
    expect(lookup(changed, "jev-latest")).toMatchObject({
      status: "unknown",
      reason: "unreviewed_id",
    });
  });

  it("does not revive an older alias when recompiling retained prices against newer ID evidence", async () => {
    const collected = await collect();
    const previous = pair(collected);
    const priorInputs = pricingCompilationEntries(previous, [collected], new Set(), undefined);
    const moved = (await fixture("models-id-pricing.md")).replace(
      /(`jev-latest`\s*\|\s*)`jev-1\.14\.0`/,
      "$1`jev-1.13.0`",
    );
    const fresh = await collect(moved, previous);
    const current = pair(fresh, previous, true);
    expect(lookup(current, "jev-latest").candidates[0]?.model_ref).toBe("typesafe/jev-1.13.0");
    const snapshot = createPricingCompilationSnapshot(current, priorInputs);
    const compiled = await compilePricingSnapshot(current, snapshot);
    expect(lookup(compiled.candidate, "jev-latest").candidates[0]?.model_ref).toBe(
      "typesafe/jev-1.13.0",
    );
    expect(compiled.candidate.inference?.mapping.sources[0]?.content_hash).toBe(
      current.catalog.sources[0]?.content_hash,
    );
  });
});
